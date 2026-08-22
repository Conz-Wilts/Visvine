/**
 * The Wayfinder Tool, proven — the last acceptance check for user-created Tools.
 *
 * scripts/seed-wayfinder-tool.ts authors the Tool through the public mechanism
 * and seeds a board with it. This script runs that seed and then asks the two
 * questions the seed cannot answer about itself:
 *
 *   1. Does the DATA hold up when something other than the Tool's own interface
 *      asks? Every check in part one goes through `handleBridgeCall` — the same
 *      door `/api/tools/bridge` opens for the frame — under the space owner, and
 *      re-reads the raw note afterwards, so a write is only "landed" when the
 *      note on disk says so.
 *
 *   2. Does it RENDER, in a real browser, where a Tool is allowed to render?
 *      Chromium logs in as the dev admin, opens `/t/wayfinder`, drives the board
 *      with real clicks, opens the project note's own page, and measures the
 *      frame against `<main>` and the app chrome.
 *
 * Needs, in this order:
 *
 *   1. `pnpm --filter @visvine/web exec playwright install chromium`
 *      (once — the browser binary is not in the repo; Chromium only)
 *   2. `pnpm dev` running, ideally with TOOLS_ORIGIN=http://127.0.0.1:3000 in
 *      apps/web/.env so the frame is served from a genuinely separate origin.
 *      Unset is a supported configuration (same-origin fallback, still
 *      sandboxed) and the run says which of the two it got rather than failing.
 *   3. `pnpm --filter @visvine/web verify:wayfinder-tool [spaceId]`
 *
 * It WRITES to the database — the seed does, and so do the move, the run and the
 * click below — so it is guarded to a local one. There is no cleanup step and
 * none is needed: the seed is idempotent, and everything this script changes it
 * changes back (the moved card, the status the click flipped), which the summary
 * reports. The one durable mark is `run:` on task 025's frontmatter, which the
 * seed leaves there too and which is the honest record of a dispatch attempt.
 *
 * If the local `.env` still carries a `CLOUD_SQL_CONNECTION_NAME` from a
 * `pnpm dev:cloud` session, the local-DB guard refuses on sight even though
 * DATABASE_URL points at Docker. Clear it for the run:
 * `CLOUD_SQL_CONNECTION_NAME= pnpm …`.
 *
 * Env:
 *   BASE_URL       the app origin, default http://localhost:3000
 *   TOOLS_ORIGIN   where the frame is served from; read, never set, here
 *   HEADED=1       watch it happen in a real window
 *   SKIP_SEED=1    assume the board is already seeded (re-runs while debugging)
 *
 * Screenshots of both surfaces are written to the OS temp dir on every run. They
 * are a debugging aid only: a sandboxed frame's text does not appear in a
 * Playwright capture even when the DOM says it rendered, so every assertion here
 * reads the DOM, the bridge, the notes API or a bounding box — never a pixel.
 */
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type FrameLocator, type Page } from 'playwright';
import prisma from '../lib/prisma';
import { ADMIN_ALIAS_ID } from '../lib/types/context';
import { getNodeTypeConfig } from '../lib/types';
import { resolveContext } from '../lib/notes/resolve';
import { readSpaceConfig } from '../lib/spaces/spaceConfig';
import { handleBridgeCall } from '../lib/tools/bridge';
import { listInstalls } from '../lib/tools/installs';
import type { BridgeMethod, BridgeResponse, ContextEntry, ContextNote } from '../lib/tools/protocol';
import { toolKey } from '../lib/tools/registry';
import { resolveBridgeTarget, type ResolvedTarget } from '../lib/tools/target';

const SPACE = process.argv[2] ?? 'community:blackbird-ventures';
const TOOL = 'wayfinder';
const PROJECT = 'visvine-tools';
const PROJECT_NOTE = `harness/${PROJECT}/project.md`;
const PROJECT_TYPE = 'wayfinder-project';

const APP = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

/** The task the run path is proven on — the same one the seed dispatches. */
const RUN_TASK_ID = '025';
/** The task the move is proven on — the same one the seed moves and puts back. */
const MOVE_TASK_ID = '026';

/**
 * Which space the shell shows, as the browser stores it. Restated from
 * features/shared/contexts/SpaceContext.tsx#CURRENT_SPACE_KEY, which is private
 * to that module — a script setting it is doing what a click on the space
 * selector does.
 */
const CURRENT_SPACE_KEY = 'nb_current_community';

/** The iframe ToolFrame renders, titled after the install. */
const FRAME = 'iframe[title="Wayfinder"]';

/**
 * How long the frame gets to mint a token, load a cross-origin document, fetch
 * its bundle and finish `loadProject` over the bridge. Generous because the
 * first hit on a cold `next dev` compiles four routes on the way.
 */
const FRAME_TIMEOUT_MS = 120_000;

const SCRIPTS = dirname(fileURLToPath(import.meta.url));

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ── reporting ─────────────────────────────────────────────────────────────────

interface Row {
  step: string;
  label: string;
  ok: boolean;
  detail: string;
}

const rows: Row[] = [];
let pass = 0;
let fail = 0;
let currentStep = '';

/** `slug` is the summary table's left column; `title` is the live heading. */
function step(slug: string, title: string): void {
  currentStep = slug;
  console.log(`\n── ${title} ${'─'.repeat(Math.max(1, 58 - title.length))}`);
}

function check(label: string, ok: boolean, detail: string): boolean {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n        ${detail.slice(0, 400)}`);
  rows.push({ step: currentStep, label, ok, detail });
  if (ok) pass++;
  else fail++;
  return ok;
}

function note(text: string): void {
  console.log(`      · ${text}`);
}

/** The summary the outcome gets pasted from: one line per assertion, aligned. */
function printSummary(): void {
  const stepWidth = Math.max(4, ...rows.map((row) => row.step.length));
  const labelWidth = Math.max(5, ...rows.map((row) => row.label.length));
  console.log(`\n── summary ${'─'.repeat(48)}`);
  console.log(`  ${'step'.padEnd(stepWidth)}  result  check`);
  console.log(`  ${'─'.repeat(stepWidth)}  ──────  ${'─'.repeat(labelWidth)}`);
  for (const row of rows) {
    console.log(`  ${row.step.padEnd(stepWidth)}  ${row.ok ? 'PASS  ' : 'FAIL  '}  ${row.label}`);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
}

// ── geometry ──────────────────────────────────────────────────────────────────

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Rectangles overlap when they overlap on BOTH axes. A shared edge does not count. */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Is `inner` inside `outer`? One pixel of slack for sub-pixel layout rounding. */
function contains(outer: Rect, inner: Rect): boolean {
  const slack = 1;
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.width <= outer.x + outer.width + slack &&
    inner.y + inner.height <= outer.y + outer.height + slack
  );
}

function describeRect(rect: Rect | null): string {
  if (!rect) return 'absent';
  return `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}×${Math.round(rect.height)}`;
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) < 1 &&
    Math.abs(a.y - b.y) < 1 &&
    Math.abs(a.width - b.width) < 1 &&
    Math.abs(a.height - b.height) < 1
  );
}

async function rectOf(page: Page, selector: string): Promise<Rect | null> {
  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0) return null;
  return locator.boundingBox();
}

/**
 * The app chrome a Tool must never be able to move.
 *
 * The RAIL is measured rather than the whole `<aside>`: the aside is one
 * persistent card that also hosts the docked context tree, so on a note route it
 * is legitimately wider than on a Tool's own page — that is Visvine's own panel
 * sliding out from under the rail, not a Tool reaching out. The rail column
 * itself (Sidebar.tsx: the first child of the card, the only width that
 * animates, and only on hover) is the same 76px on every route, so it is the
 * thing that must hold still. The aside is carried along as evidence.
 */
interface Chrome {
  navbar: Rect | null;
  rail: Rect | null;
  aside: Rect | null;
}

async function chromeOf(page: Page): Promise<Chrome> {
  try {
    return {
      navbar: await rectOf(page, 'header'),
      rail: await rectOf(page, 'aside > div > div'),
      aside: await rectOf(page, 'aside'),
    };
  } catch {
    // Mid-navigation the execution context goes away under the measurement. A
    // sample that could not be read is not a chrome that moved, so it comes
    // back empty and is dropped rather than counted against the page.
    return { navbar: null, rail: null, aside: null };
  }
}

function describeChrome(chrome: Chrome): string {
  return `navbar ${describeRect(chrome.navbar)} · rail ${describeRect(chrome.rail)} · aside ${describeRect(chrome.aside)}`;
}

function sameChrome(a: Chrome, b: Chrome): boolean {
  return sameRect(a.navbar, b.navbar) && sameRect(a.rail, b.rail);
}

/**
 * Run `work` — the whole of opening a page and waiting for its Tool to draw —
 * and sample the chrome all the way through, rather than comparing two
 * endpoints: "the navbar did not move" is a claim about every moment a
 * stranger's code was starting up, and a before/after pair would miss anything
 * that moved and moved back.
 *
 * Samples taken before the shell exists (or through a navigation that pulled
 * the execution context out from under the measurement) carry no rectangles and
 * are dropped; the baseline is the first sample that had one.
 */
async function whileLoading<T>(
  page: Page,
  work: () => Promise<T>,
): Promise<{ value: T; samples: Chrome[]; steady: boolean }> {
  let finished = false;
  // Settled into a value rather than left to reject: the sampling loop can sit
  // on a sleep after `work` fails, which is long enough for a rejection nobody
  // is awaiting yet to be reported as unhandled.
  const running = work()
    .then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    .finally(() => {
      finished = true;
    });
  const taken: Chrome[] = [];
  while (!finished) {
    taken.push(await chromeOf(page));
    if (!finished) await sleep(150);
  }
  const result = await running;
  taken.push(await chromeOf(page));
  if (!result.ok) throw result.error instanceof Error ? result.error : new Error(String(result.error));
  const samples = taken.filter((sample) => sample.navbar !== null && sample.rail !== null);
  return {
    value: result.value,
    samples,
    steady: samples.length > 0 && samples.every((sample) => sameChrome(sample, samples[0])),
  };
}

// ── the documents the tool speaks in ──────────────────────────────────────────

interface TaskDoc {
  path: string;
  id: string;
  title: string;
  status: string;
  size: string;
  wave: number;
  agent: string;
  run: { id: string; status: string; at: string; detail: string } | null;
  outcome: string;
}

interface Board {
  project: { name: string; path: string; title: string; waves: Array<{ n: number; title: string }> };
  tasks: TaskDoc[];
  truncated: boolean;
}

interface RunOutcome {
  task: TaskDoc;
  brief: { path: string; name: string; status: string; reason: string; text: string };
  run: { id: string; status: string; at: string; detail: string };
}

// ── the run ───────────────────────────────────────────────────────────────────

async function serverIsUp(): Promise<boolean> {
  try {
    await fetch(`${APP}/`, { signal: AbortSignal.timeout(5_000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run the seed as its own process rather than importing it: it is a top-level
 * script that disconnects the Prisma singleton when it finishes, which would
 * close the pool this script still needs. `CLOUD_SQL_CONNECTION_NAME` is passed
 * as an empty string on purpose — the guard refuses a set one, and an unset key
 * would just be re-read out of `.env` by the guard's own loader.
 */
function runSeed(): { ok: boolean; detail: string } {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', join(SCRIPTS, 'seed-wayfinder-tool.ts'), SPACE],
    {
      cwd: join(SCRIPTS, '..'),
      env: { ...process.env, CLOUD_SQL_CONNECTION_NAME: '' },
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  for (const line of output.split(/\r?\n/)) {
    if (/^\s*(PASS|FAIL|ok)\s/.test(line) || /check\(s\) failed/.test(line)) console.log(`      | ${line.trim()}`);
  }
  if (result.error) return { ok: false, detail: result.error.message };
  const failed = /(\d+) check\(s\) failed/.exec(output);
  return {
    ok: result.status === 0 && failed?.[1] === '0',
    detail: `exit ${result.status} · ${failed ? `${failed[1]} check(s) failed` : 'no check line'}`,
  };
}

async function main(): Promise<void> {
  const holder = await prisma.userAlias.findFirst({
    where: { spaceId: SPACE, aliasId: ADMIN_ALIAS_ID },
    select: { userId: true },
  });
  if (!holder) throw new Error(`nobody manages ${SPACE}`);
  const owner = await prisma.user.findUnique({
    where: { id: holder.userId },
    select: { id: true, name: true, email: true },
  });
  if (!owner) throw new Error(`alias holder ${holder.userId} has no user row`);

  const session = { userId: owner.id, name: owner.name ?? '', email: owner.email ?? '', personId: null };
  const resolved = await resolveContext(session, SPACE);
  if (resolved instanceof Response) throw new Error(`resolveContext: ${resolved.status}`);

  console.log(`space   ${SPACE}`);
  console.log(`owner   ${owner.email} (${owner.id})`);
  console.log(`app     ${APP}`);
  console.log(`tools   ${process.env.TOOLS_ORIGIN || '(unset — same-origin fallback)'}`);

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  /** Undone at the end so a second run starts from the same board. */
  let restore: (() => Promise<void>) | null = null;
  /** Everything the browser said, kept for a failure that needs explaining. */
  const browserSays: string[] = [];

  try {
    // ── 1. the seed ──────────────────────────────────────────────────────────
    step('seed', '1. seed the Wayfinder Tool and its board');
    if (process.env.SKIP_SEED === '1') {
      note('SKIP_SEED=1 — using whatever is already in the database');
    } else {
      const seeded = runSeed();
      if (!check('the seed authors, installs and fills the board with no failed checks', seeded.ok, seeded.detail)) {
        throw new Error('the seed did not pass — nothing below would mean anything');
      }
    }

    const install = (await listInstalls(SPACE)).find((row) => row.key === toolKey(SPACE, TOOL));
    if (!install) throw new Error(`${TOOL} is not installed in ${SPACE}`);
    note(`install ${install.slug} v${install.version} · claims ${JSON.stringify(install.typeClaims)}`);

    // The in-process door: the same handler `/api/tools/bridge` calls, resolved
    // for this install under the space owner's own grants.
    const targetOrError = await resolveBridgeTarget(session, { kind: 'install', installId: install.id });
    if (!('principal' in targetOrError)) {
      throw new Error(`resolveBridgeTarget refused: ${targetOrError.code} ${targetOrError.message}`);
    }
    const target: ResolvedTarget = targetOrError;

    /** One bridge call, refusals raised so a caller can assert on the value. */
    async function bridge<T>(method: BridgeMethod, params: unknown): Promise<T> {
      const response: BridgeResponse = await handleBridgeCall(target, method, params);
      if (!response.ok) throw new Error(`${method}: ${response.error.code} — ${response.error.message}`);
      return response.value as T;
    }

    /** One `data.call` into the Tool's own isolate. */
    const call = <T>(fn: string, args: unknown): Promise<T> => bridge<T>('data.call', { fn, args });

    /** The raw note, so a write can be judged on what is stored rather than what was returned. */
    const readNote = (path: string): Promise<ContextNote> => bridge<ContextNote>('context.read', { path });

    // ── 2. context.list ──────────────────────────────────────────────────────
    step('context.list', '2. context.list harness/** — the board is really notes');
    const entries = await bridge<ContextEntry[]>('context.list', { glob: 'harness/**' });
    const projectEntry = entries.find((entry) => entry.path === PROJECT_NOTE);
    const taskEntries = entries.filter((entry) => (entry.type ?? '').toLowerCase() === 'wayfinder-task');
    check(
      'the seeded project note and its tasks come back through the bridge',
      projectEntry !== undefined &&
        (projectEntry.type ?? '').toLowerCase() === PROJECT_TYPE &&
        taskEntries.length > 0,
      `${entries.length} entr(ies) under harness/ · project ${projectEntry ? `${projectEntry.path} (${projectEntry.type})` : 'MISSING'} · ${taskEntries.length} task note(s)`,
    );

    // ── 3. loadProject ───────────────────────────────────────────────────────
    step('loadProject', '3. data.call loadProject — waves and tasks, grouped');
    const board = await call<Board>('loadProject', { project: PROJECT });
    const waveNumbers = board.project.waves.map((wave) => wave.n);
    const grouped = waveNumbers.map((n) => ({ n, tasks: board.tasks.filter((task) => task.wave === n).length }));
    const orphans = board.tasks.filter((task) => !waveNumbers.includes(task.wave));
    check(
      'loadProject returns the waves with every task sitting in one of them',
      board.project.waves.length > 0 &&
        board.tasks.length > 0 &&
        orphans.length === 0 &&
        grouped.filter((wave) => wave.tasks > 0).length > 1 &&
        !board.truncated,
      `${board.project.title} · ${board.project.waves.length} waves · ${board.tasks.length} tasks · ` +
        `${grouped.map((wave) => `w${wave.n}×${wave.tasks}`).join(' ')}` +
        `${orphans.length > 0 ? ` · ORPHANS ${orphans.map((task) => `${task.id}@${task.wave}`).join(', ')}` : ''}`,
    );

    // ── 4. moveTask ──────────────────────────────────────────────────────────
    //
    // A card moving between columns is one frontmatter field rewritten in place,
    // so the note itself is the only witness worth calling.
    step('moveTask', '4. data.call moveTask — the note frontmatter is what moved');
    const mover = board.tasks.find((task) => task.id === MOVE_TASK_ID) ?? board.tasks[0];
    const homeWave = mover.wave;
    const targetWave = waveNumbers.find((n) => n !== homeWave) ?? homeWave + 1;
    await call('moveTask', { path: mover.path, wave: targetWave });
    const afterMove = await readNote(mover.path);
    await call('moveTask', { path: mover.path, wave: homeWave });
    const afterBack = await readNote(mover.path);
    check(
      "moveTask rewrites the task note's `wave`, and putting it back restores it",
      afterMove.frontmatter.wave === targetWave && afterBack.frontmatter.wave === homeWave,
      `${mover.id} wave ${homeWave} → note says ${JSON.stringify(afterMove.frontmatter.wave)} → back to ${JSON.stringify(afterBack.frontmatter.wave)}`,
    );

    // ── 5. runTask ───────────────────────────────────────────────────────────
    //
    // The dispatch path, reported rather than wished for. Since 057 narrowed the
    // seal, a Tool may CREATE the brief of an agent its own perimeter names
    // (lib/tools/bridge.ts#agentBriefExemption) — the Wayfinder Tool's does, so
    // the brief is always there by the time the run is attempted. Two answers
    // are legible and exactly one of them must come back:
    //
    //   dispatched  the brief was present or freshly written, `visvine.agents.run`
    //               returned a run id
    //   refused     the brief was present or freshly written, the run was
    //               refused for a reason a person can act on — no model key,
    //               agent not activated — which is what a local run gives
    //
    // ACTIVATION (`agents/live/<name>.md`) is still admin-only and untouched by
    // this exemption, so REFUSED is the honest local answer, not a gap.
    step('runTask', '5. data.call runTask — the agent dispatch path, told honestly');
    const runnable = board.tasks.find((task) => task.id === RUN_TASK_ID) ?? board.tasks[0];
    const outcome = await call<RunOutcome>('runTask', { path: runnable.path });
    const expectedName = `wayfinder-${PROJECT}-${runnable.id.toLowerCase()}`;
    const expectedBrief = `agents/${expectedName}.md`;
    const briefOk = outcome.brief.status === 'written' || outcome.brief.status === 'present';
    const dispatched = briefOk && outcome.run.status === 'queued' && outcome.run.id !== '';
    const refused = briefOk && outcome.run.status === 'refused' && outcome.run.detail !== '';
    const verdict = dispatched ? 'DISPATCHED' : refused ? 'REFUSED' : 'UNREADABLE';
    check(
      `runTask names ${expectedBrief} and gives back a run id or a reason a person can act on`,
      outcome.brief.name === expectedName &&
        outcome.brief.path === expectedBrief &&
        (dispatched || refused),
      `${verdict} · brief ${outcome.brief.status}${outcome.brief.reason ? ` (${outcome.brief.reason})` : ''} · ` +
        `run ${outcome.run.status}${outcome.run.id ? ` id=${outcome.run.id}` : ''}${outcome.run.detail ? ` — ${outcome.run.detail}` : ''}`,
    );
    const recorded = await readNote(runnable.path);
    const recordedRun = recorded.frontmatter.run as { status?: string } | undefined;
    check(
      'the attempt is recorded on the task note, so the board still says so after a reload',
      recorded.frontmatter.agent === expectedName && recordedRun?.status === outcome.run.status,
      `agent ${JSON.stringify(recorded.frontmatter.agent)} · run ${JSON.stringify(recorded.frontmatter.run)}`,
    );

    // ── 6. a real browser ────────────────────────────────────────────────────
    step('browser', '6. headless Chromium, logged in as the dev admin');
    const up = await serverIsUp();
    if (!check('the dev server answers', up, up ? APP : `${APP} is not answering — start \`pnpm dev\``)) {
      throw new Error('nothing to drive');
    }

    browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    // `page` stays nullable so the failure path can still screenshot a run that
    // died before the browser started; TypeScript cannot carry that narrowing
    // into the callbacks below, so they close over this alias instead.
    const livePage = page;
    page.on('console', (message) => browserSays.push(`${message.type()}: ${message.text()}`));
    page.on('pageerror', (error) => browserSays.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) =>
      browserSays.push(`requestfailed: ${request.url().slice(0, 160)} — ${request.failure()?.errorText}`),
    );

    const loginResponse = await page.goto(`${APP}/dev/login`, { waitUntil: 'domcontentloaded' });
    if (loginResponse?.status() === 404) {
      throw new Error('/dev/login is 404 — set NODE_ENV=development and ENABLE_DEV_AUTH=true');
    }
    const loginButton = page.locator(`form[action^="/api/dev/login-as/${owner.id}"] button`);
    if ((await loginButton.count()) === 0) {
      throw new Error(`${owner.email} is not on /dev/login — dev login lists @local.dev users only`);
    }
    await loginButton.first().click();
    await page.waitForURL((url) => !url.pathname.startsWith('/dev/login'), { timeout: 30_000 });
    const cookies = await context.cookies(APP);
    check(
      `the viewer is logged in on the app origin as ${owner.email}`,
      cookies.some((cookie) => cookie.name === 'auth_session'),
      `${page.url()} · cookies [${cookies.map((cookie) => cookie.name).join(', ')}]`,
    );
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
      key: CURRENT_SPACE_KEY,
      value: SPACE,
    });

    // The shell with no Tool on it anywhere. Every chrome measurement below is
    // taken against THIS, not merely against another moment of the same Tool
    // page: on a warm server a frame can be up inside one sampling interval, and
    // "it never moved during a window that turned out to be 200ms" is not the
    // claim worth making. Where the navbar and the rail sit when no Tool is
    // involved is.
    const shellChrome = await chromeOf(page);
    check(
      'the app shell, before any Tool is opened, has a navbar and a rail to compare against',
      shellChrome.navbar !== null && shellChrome.rail !== null,
      `${page.url()} · ${describeChrome(shellChrome)}`,
    );

    /**
     * Wait for the frame to have finished its handshake AND drawn. There is no
     * `data-tool-ready` attribute to poll — the host never marks the DOM — and
     * the frame's document is cross-origin, so the honest signal is the Tool's
     * own content: the page header it only renders once `loadProject` came back
     * through the bridge.
     */
    async function waitForFrame(current: Page, heading: string): Promise<FrameLocator> {
      const element = current.locator(FRAME);
      await element.waitFor({ state: 'attached', timeout: FRAME_TIMEOUT_MS });
      const frame = current.frameLocator(FRAME);
      await frame
        .locator('h1.vv-page-header__title', { hasText: heading })
        .waitFor({ state: 'attached', timeout: FRAME_TIMEOUT_MS });
      return frame;
    }

    // ── 7. the rail page and the board ───────────────────────────────────────
    step('/t/wayfinder', '7. /t/wayfinder — the board renders inside the frame');
    // The navigation is inside the watch, so the chrome is sampled across the
    // whole of it — the page load, the token mint, the cross-origin document,
    // the bundle and the Tool's first bridge call.
    const railWatch = await whileLoading(livePage, async () => {
      await livePage.goto(`${APP}/t/${TOOL}`, { waitUntil: 'domcontentloaded' });
      return waitForFrame(livePage, 'Wayfinder');
    });
    const frameElement = page.locator(FRAME);
    const frameSrc = (await frameElement.getAttribute('src')) ?? '';
    const frameHost = frameSrc ? new URL(frameSrc).origin : '';
    const separateOrigin = frameHost !== '' && frameHost !== APP;
    check(
      'the Tool frame is on the page, served from the tools origin',
      frameSrc.includes('/api/tools/runtime/frame'),
      `${page.url()} · frame from ${frameHost || '(no src)'}${
        separateOrigin ? ' (separate tools origin)' : ' (same-origin fallback — TOOLS_ORIGIN unset)'
      }`,
    );

    const chromeBefore = railWatch.samples[0];
    check(
      'the navbar and the rail sit exactly where they do with no Tool, all through the load',
      railWatch.steady && sameChrome(chromeBefore, shellChrome),
      `${railWatch.samples.length} sample(s) over the load · ${describeChrome(chromeBefore)}` +
        (sameChrome(chromeBefore, shellChrome) ? ' (identical to the Tool-free shell)' : ` ≠ shell ${describeChrome(shellChrome)}`) +
        (railWatch.steady ? '' : ` → MOVED to ${describeChrome(railWatch.samples[railWatch.samples.length - 1])}`),
    );

    const railFrame = railWatch.value;
    const projectCard = railFrame.locator('.vv-card').filter({ hasText: board.project.title }).first();
    await projectCard.waitFor({ state: 'attached', timeout: FRAME_TIMEOUT_MS });
    const projectCardText = (await projectCard.innerText()).replace(/\s+/g, ' ');
    check(
      'the rail page lists the seeded project by name, path and task count',
      projectCardText.includes(board.project.title) &&
        projectCardText.includes(PROJECT_NOTE) &&
        projectCardText.includes(`${board.tasks.length} task`),
      projectCardText.slice(0, 200),
    );

    await projectCard.getByRole('button', { name: 'Open', exact: true }).click();
    const boardFrame = await waitForFrame(page, board.project.title);
    // One Run button per TaskCard and one "+ Add task" per wave column, so the
    // board is counted by what it offers rather than by the inline styles it is
    // drawn with.
    const heading = await boardFrame.locator('h1.vv-page-header__title').innerText();
    const cardCount = await boardFrame.getByRole('button', { name: 'Run', exact: true }).count();
    const columns = await boardFrame.getByRole('button', { name: '+ Add task', exact: true }).count();
    check(
      'the board shows the project name, one column per wave and a card per task',
      heading === board.project.title &&
        cardCount === board.tasks.length &&
        cardCount > 0 &&
        columns === board.project.waves.length,
      `h1 "${heading}" · ${cardCount} card(s) for ${board.tasks.length} task(s) · ${columns} column(s) for ${board.project.waves.length} wave(s)`,
    );

    const boardShot = join(tmpdir(), `verify-wayfinder-tool-board-${Date.now()}.png`);
    await page.screenshot({ path: boardShot, fullPage: true });
    note(`screenshot ${boardShot}`);

    // ── 8. a click writes a note ─────────────────────────────────────────────
    //
    // Read back through the app's own notes API with the viewer's cookie —
    // deliberately not the bridge this script has been using, so the claim is
    // "the note changed" and not "the Tool says the note changed".
    step('click', '8. clicking Done on a card writes the task note');
    const clickable = board.tasks.find((task) => task.status !== 'done');
    if (!clickable) throw new Error('every seeded task is already done — nothing to click');
    const card = boardFrame
      .locator('div')
      .filter({ hasText: `${clickable.id} ${clickable.title}` })
      .filter({ has: boardFrame.getByRole('button', { name: 'Run', exact: true }) })
      .last();
    await card.getByRole('button', { name: 'Done', exact: true }).click();

    // Polled, not raced: the click goes frame → host → bridge → isolate → store,
    // and the API read is a different request on a different connection.
    const noteUrl = `${APP}/api/notes/item?${new URLSearchParams({ spaceId: SPACE, path: clickable.path })}`;
    let apiStatus = 0;
    let written: string | null = null;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const apiResponse = await page.request.get(noteUrl);
      apiStatus = apiResponse.status();
      if (apiResponse.ok()) {
        const apiBody = (await apiResponse.json()) as { content?: string };
        written = /^status:\s*"?([a-z]+)"?\s*$/m.exec(apiBody.content ?? '')?.[1] ?? null;
        if (written === 'done') break;
      }
      await sleep(500);
    }
    check(
      'the note itself says `status: done` when read back through /api/notes/item',
      written === 'done',
      `${clickable.id} ${clickable.path} · was ${clickable.status} · API ${apiStatus} says ${written ?? '(no status line)'}`,
    );
    restore = async () => {
      await call('saveTask', { project: PROJECT, path: clickable.path, patch: { status: clickable.status } });
    };

    const chromeAfter = await chromeOf(page);
    check(
      'and they had still not moved after the Tool opened a board and wrote a note',
      sameChrome(chromeBefore, chromeAfter),
      `before ${describeChrome(chromeBefore)} → after ${describeChrome(chromeAfter)}`,
    );
    const mainRect = await rectOf(page, 'main');
    const frameRect = await frameElement.boundingBox();
    check(
      'the frame renders inside <main>, over neither the navbar nor the rail',
      mainRect !== null &&
        frameRect !== null &&
        contains(mainRect, frameRect) &&
        chromeAfter.navbar !== null &&
        !overlaps(chromeAfter.navbar, frameRect) &&
        chromeAfter.rail !== null &&
        !overlaps(chromeAfter.rail, frameRect),
      `frame ${describeRect(frameRect)} · main ${describeRect(mainRect)} · ${describeChrome(chromeAfter)}`,
    );

    // ── 9. the project note's own page ───────────────────────────────────────
    step('note page', '9. /directory/note/… — the Tool IS the wayfinder-project page');
    const noteWatch = await whileLoading(livePage, async () => {
      await livePage.goto(`${APP}/directory/note/${PROJECT_NOTE}`, { waitUntil: 'domcontentloaded' });
      // The route mounts with the plain Context/Raw bar and swaps the type tab
      // in once it has resolved which Tool owns this note's type — so wait for
      // the tab itself, not merely for a tab bar, or the answer below is the
      // wrong moment's.
      await livePage.locator('#tab-tool').waitFor({ state: 'visible', timeout: FRAME_TIMEOUT_MS });
      return waitForFrame(livePage, board.project.title);
    });
    const tabs = page.locator('[role="tablist"][aria-label="Note sections"] [role="tab"]');
    const labels = await tabs.allInnerTexts();
    const firstSelected = await tabs.first().getAttribute('aria-selected');
    // The tab is named after the TYPE, not the Tool — the same string the note
    // route builds from the space's own vocabulary.
    const typeLabel = getNodeTypeConfig(PROJECT_TYPE, (await readSpaceConfig(SPACE))?.nodeTypes ?? undefined).name;
    check(
      'the type tab is first and selected, with Context and Raw beside it',
      labels[0] === typeLabel &&
        firstSelected === 'true' &&
        labels.includes('Context') &&
        labels.includes('Raw'),
      `tabs [${labels.join(' | ')}] · first aria-selected=${firstSelected} · type label "${typeLabel}"`,
    );

    const noteFrame = noteWatch.value;
    check(
      'the board renders beneath the tab bar as the note’s page',
      (await noteFrame.getByRole('button', { name: 'Run', exact: true }).count()) === board.tasks.length,
      `h1 "${await noteFrame.locator('h1.vv-page-header__title').innerText()}" · ${await noteFrame
        .getByRole('button', { name: 'Run', exact: true })
        .count()} card(s)`,
    );

    const noteMain = await rectOf(page, 'main');
    const tabBar = await rectOf(page, '[role="tablist"][aria-label="Note sections"]');
    const noteFrameRect = await page.locator(FRAME).boundingBox();
    const noteChromeAfter = await chromeOf(page);
    check(
      'that frame is inside <main>, under the tab bar, and clear of the navbar',
      noteMain !== null &&
        noteFrameRect !== null &&
        contains(noteMain, noteFrameRect) &&
        tabBar !== null &&
        noteFrameRect.y >= tabBar.y + tabBar.height - 1 &&
        noteChromeAfter.navbar !== null &&
        !overlaps(noteChromeAfter.navbar, noteFrameRect),
      `frame ${describeRect(noteFrameRect)} · main ${describeRect(noteMain)} · tab bar ${describeRect(tabBar)} · navbar ${describeRect(noteChromeAfter.navbar)}`,
    );
    check(
      'and they are still exactly where the Tool-free shell put them on this route too',
      noteWatch.steady &&
        sameChrome(noteWatch.samples[0], noteChromeAfter) &&
        sameChrome(noteChromeAfter, shellChrome),
      `${noteWatch.samples.length} sample(s) over the load · ${describeChrome(noteChromeAfter)}` +
        (sameChrome(noteChromeAfter, shellChrome) ? ' (identical to the Tool-free shell)' : ` ≠ shell ${describeChrome(shellChrome)}`),
    );

    const noteShot = join(tmpdir(), `verify-wayfinder-tool-note-${Date.now()}.png`);
    await page.screenshot({ path: noteShot, fullPage: true });
    note(`screenshot ${noteShot}`);

    // Context and Raw are not decoration: the same note still opens as a note.
    await page.locator('[role="tab"]', { hasText: 'Raw' }).first().click();
    await page.locator(FRAME).waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});
    const rawFrames = await page.locator(FRAME).count();
    await page.locator('#tab-tool').click();
    await waitForFrame(page, board.project.title);
    check(
      'Raw takes the frame away and the type tab brings the board back',
      rawFrames === 0 && (await page.locator(FRAME).count()) === 1,
      `frames on Raw ${rawFrames} · frames back on the ${typeLabel} tab ${await page.locator(FRAME).count()}`,
    );
  } catch (e) {
    fail++;
    rows.push({
      step: currentStep || 'run',
      label: 'the run finished without throwing',
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
    console.error(`\nFAIL  ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    // The frame's document is cross-origin and its text never reaches a
    // screenshot, so the browser's own account is the only record of what it
    // was doing when this went wrong.
    if (browserSays.length > 0) {
      console.log(`\n        what the browser said (last ${Math.min(30, browserSays.length)} of ${browserSays.length}):`);
      for (const line of browserSays.slice(-30)) console.log(`          ${line.slice(0, 220)}`);
    }
    if (page) {
      const shot = join(tmpdir(), `verify-wayfinder-tool-failure-${Date.now()}.png`);
      await page.screenshot({ path: shot, fullPage: true }).then(
        () => console.log(`\nscreenshot  ${shot}`),
        () => {},
      );
    }
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    if (restore) {
      step('restore', 'restore');
      await restore().then(
        () => console.log('  ok    the clicked task is back at the status the seed gives it'),
        (e: unknown) => console.log(`  --    could not restore: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
    printSummary();
    if (fail > 0) process.exitCode = 1;
  }
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
