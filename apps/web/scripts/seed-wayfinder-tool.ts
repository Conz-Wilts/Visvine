/**
 * Seed the **Wayfinder Tool** — the acceptance test for user-created Tools.
 *
 * The Wayfinder harness's own planning board (a goal, its waves, a task board
 * over them, and a Run button that dispatches an agent) rebuilt as a Visvine
 * Tool, authored through the public mechanism and nothing else:
 *
 *   appToolHandlers.createTool / writeTool ×3 → publish → super-admin approve →
 *   install → ensure the two custom node types → seed a project THROUGH THE
 *   TOOL'S OWN data.js over the bridge
 *
 * The sources live in `examples/tools/wayfinder/` as real files a member could
 * have written; nothing here compiles them by hand or reaches past the handlers.
 * The seeded project mirrors this plan, so the board opens populated.
 *
 * Idempotent. Every step checks first: an existing Tool is written over rather
 * than re-created, an unchanged working copy is not re-published, an install
 * that is already current is left alone, and the project is patched rather than
 * duplicated. Re-running it is how you pick up an edit to the example sources.
 *
 *   pnpm --filter @visvine/web exec tsx scripts/seed-wayfinder-tool.ts [spaceId]
 *
 * Local only (guarded like every db:* script). If the local `.env` still carries
 * a `CLOUD_SQL_CONNECTION_NAME` from a `pnpm dev:cloud` session, clear it for the
 * run: `CLOUD_SQL_CONNECTION_NAME= pnpm …`.
 *
 * It does NOT need `pnpm dev` — everything is in-process. What it cannot do is
 * finish an agent run: the board writes the brief (that much a Tool may do, for
 * an agent its perimeter names), but a run needs an admin-ACTIVATED agent and a
 * model key, so the last step asserts the dispatch path and stops where a person
 * has to say yes. See docs/wayfinder-tool.md.
 */
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import prisma from '../lib/prisma';
import { ADMIN_ALIAS_ID } from '../lib/types/context';
import { mergeNodeType, mergeNodeTypeList, type NodeTypeConfig } from '../lib/types';
import { updateSpaceConfig } from '../lib/spaces/spaceConfig';
import { splitFrontmatter } from '../lib/notes/shared/markdown';
import { resolveContext } from '../lib/notes/resolve';
import { McpError, type McpContext } from '../lib/mcp/auth';
import { appToolHandlers } from '../lib/mcp/appTools';
import { handleBridgeCall } from '../lib/tools/bridge';
import { applyUpgrade, listInstalls } from '../lib/tools/installs';
import type { BridgeResponse } from '../lib/tools/protocol';
import { getVersion, reviewVersion, toolKey, versionHistory } from '../lib/tools/registry';
import { resolveBridgeTarget, type ResolvedTarget } from '../lib/tools/target';

const SPACE = process.argv[2] ?? 'community:blackbird-ventures';
const TOOL = 'wayfinder';
const PROJECT = 'visvine-tools';

/** The two member-invented types the Tool owns the page for. */
const NODE_TYPES = ['wayfinder-project', 'wayfinder-task'] as const;

const SOURCES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'examples', 'tools', TOOL);
const source = (name: string): string => readFileSync(join(SOURCES, name), 'utf8');

// ── the project this seeds: the plan that built the Tools feature ─────────────

const GOAL =
  'Let members build essentially anything as a Tool — running in their space, over its own notes, shareable through a marketplace.';

const BRIEF = [
  'A member points a vibe-coding agent at Visvine\'s MCP server, describes a Tool, and gets a',
  'working one: it renders in the main content area, reads and writes real space data within its',
  'declared perimeter, and can be published to a marketplace other spaces install from.',
  '',
  'A Tool is three notes (index.md + ui.tsx + data.js), sandboxed on a cookie-less origin, and',
  'reaches Visvine only through a capability-gated bridge under the viewer\'s own grants.',
  '',
  'The acceptance test is this board: if the harness that built the feature can be rebuilt as a',
  'Tool, the mechanism is real.',
].join('\n');

const PLAN = [
  'Build Tools as the third note-first entity, after connectors and agents, reusing every existing',
  'seam: notes for storage and history, the QuickJS isolate for data.js, featureConfig for rail',
  'placement, MCP for authoring, super-admin for review.',
  '',
  'Six waves, each verified and checkpointed before the next starts.',
].join('\n');

const WAVES = [
  { n: 1, title: 'Foundations' },
  { n: 2, title: 'Services' },
  { n: 3, title: 'Surfaces' },
  { n: 4, title: 'Type pages + verification' },
  { n: 5, title: 'Acceptance' },
  { n: 6, title: 'Proof + close' },
];

interface SeedTask {
  id: string;
  title: string;
  status: 'todo' | 'doing' | 'done' | 'failed';
  size: string;
  wave: number;
  depends_on: string[];
  touches: string[];
  task: string;
}

/** A representative slice of the real plan — enough to fill every column. */
const TASKS: SeedTask[] = [
  {
    id: '003',
    title: 'Tool config, paths, source wrapping and perimeter matcher',
    status: 'done',
    size: 'm',
    wave: 1,
    depends_on: [],
    touches: ['lib/tools/config.ts', 'lib/tools/perimeter.ts'],
    task: 'The pure contract: what a Tool note looks like, where its files live, and which notes, types, connectors and agents a declared perimeter reaches.',
  },
  {
    id: '004',
    title: 'Server-side TSX compile pipeline (esbuild) with size caps',
    status: 'done',
    size: 'm',
    wave: 1,
    depends_on: ['003'],
    touches: ['lib/tools/compile.ts'],
    task: 'Compile ui.tsx to a browser ESM bundle and parse-check data.js, refusing every import but react and @visvine/tool-kit. Diagnostics come back to the author on the write.',
  },
  {
    id: '009',
    title: 'Bridge protocol, in-frame SDK client, Visvine UI kit, author docs',
    status: 'done',
    size: 'l',
    wave: 1,
    depends_on: ['003'],
    touches: ['lib/tools/protocol.ts', 'features/tools/kit/**'],
    task: 'The wire contract between the frame and the host, the SDK a Tool imports as @visvine/tool-kit, and the guide an authoring agent reads before writing anything.',
  },
  {
    id: '011',
    title: 'Server bridge: perimeter-gated handlers + /api/tools/bridge',
    status: 'done',
    size: 'l',
    wave: 2,
    depends_on: ['003', '009'],
    touches: ['lib/tools/bridge.ts'],
    task: 'The one door from a running Tool to real data: context read/write, connectors, agents, data.call and state — each gated by the perimeter and then by the viewer\'s own grants.',
  },
  {
    id: '012',
    title: 'Registry: publish snapshots, review, install/upgrade, requirements',
    status: 'done',
    size: 'l',
    wave: 2,
    depends_on: ['003'],
    touches: ['lib/tools/registry.ts', 'lib/tools/installs.ts'],
    task: 'Publishing snapshots an immutable version for a super-admin to review; installs pin a version and never change under a space silently.',
  },
  {
    id: '016',
    title: 'MCP authoring tools: create/read/write/check/publish/install',
    status: 'done',
    size: 'l',
    wave: 3,
    depends_on: ['010', '012'],
    touches: ['lib/mcp/appTools.ts'],
    task: 'The authoring loop over MCP, so an agent in someone else\'s editor can write a Tool and read its compile errors in one call.',
  },
  {
    id: '017',
    title: 'Installed Tools in the sidebar rail and their /t/[slug] page',
    status: 'done',
    size: 'm',
    wave: 3,
    depends_on: ['012'],
    touches: ['features/shared/lib/features.tsx', 'app/(auth)/t/[slug]/page.tsx'],
    task: 'Each install becomes a rail row and a full-pane page, ordered with the existing featureConfig machinery. Installing must never move a space\'s front door.',
  },
  {
    id: '022',
    title: 'Data-driven type pages for custom types',
    status: 'done',
    size: 'l',
    wave: 4,
    depends_on: ['017'],
    touches: ['lib/tools/typePages.ts'],
    task: 'A Tool may own the page for a member-invented type; built-in pages stay built in and get a tab at most. This board rides that: a wayfinder-project note IS this board.',
  },
  {
    id: '024',
    title: 'Adversarial escape suite: hostile Tool fixtures',
    status: 'doing',
    size: 'l',
    wave: 5,
    depends_on: ['011'],
    touches: ['scripts/verify-tools-escape.ts'],
    task: 'A hostile Tool attempting undeclared reads, cookie theft, escaping the content area and cross-space access — each must fail.',
  },
  {
    id: '025',
    title: 'The Wayfinder Tool: this board',
    status: 'doing',
    size: 'l',
    wave: 5,
    depends_on: ['016', '022'],
    touches: ['examples/tools/wayfinder/**', 'scripts/seed-wayfinder-tool.ts'],
    task: 'Rebuild the harness\'s planning board as a Tool, authored only through the public mechanism. If this works, the mechanism is real.',
  },
  {
    id: '026',
    title: 'Verify script for the Wayfinder Tool',
    status: 'todo',
    size: 'm',
    wave: 6,
    depends_on: ['025'],
    touches: ['scripts/verify-wayfinder-tool.ts'],
    task: 'Drive the seeded board end to end: it renders, a task moves, a write lands on the right note, and the agent dispatch path answers honestly.',
  },
  {
    id: '027',
    title: 'Final audit: typecheck/lint/test/knip zero, docs current',
    status: 'todo',
    size: 'm',
    wave: 6,
    depends_on: ['026'],
    touches: ['docs/tools.md'],
    task: 'Close the loose ends the waves left, and make sure the docs describe what actually shipped.',
  },
];

// ── reporting ────────────────────────────────────────────────────────────────

let failures = 0;

function step(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(1, 58 - title.length))}`);
}

function done(detail: string): void {
  console.log(`  ok    ${detail}`);
}

function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}\n        ${detail.slice(0, 400)}`);
  if (!ok) failures++;
}

// ── the run ──────────────────────────────────────────────────────────────────

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
  // Not used directly — every write below goes through a handler or the bridge,
  // which resolve their own principal. Asked here so a space this user cannot
  // reach fails on the first line rather than four steps in.
  const resolved = await resolveContext(session, SPACE);
  if (resolved instanceof Response) throw new Error(`resolveContext: ${resolved.status}`);
  const actor = { userId: owner.id, email: owner.email ?? '' };

  /** What the MCP transport hands the handlers after verifying a token. */
  const ctx: McpContext = {
    userId: owner.id,
    name: owner.name ?? '',
    email: owner.email ?? '',
    personId: null,
    scopes: ['context:read', 'context:write', 'tools:author', 'tools:install'],
  };

  console.log(`space   ${SPACE}`);
  console.log(`owner   ${owner.email} (${owner.id})`);
  console.log(`sources ${SOURCES}`);

  // ── 1. the two custom types ────────────────────────────────────────────────
  //
  // Before the install, not after: `resolveTypeClaims` only grants `mode: page`
  // for a type the space already has, and downgrades the rest to a tab.
  step('1. node types');
  const added: string[] = [];
  await updateSpaceConfig(SPACE, (stored) => {
    let working = (stored.nodeTypes ?? []) as NodeTypeConfig[];
    for (const name of NODE_TYPES) {
      const merged = mergeNodeType(working, { name });
      if (!merged.ok) throw new Error(`${name}: ${merged.error}`);
      working = merged.types;
      if (merged.created) added.push(merged.type.name);
    }
    return { nodeTypes: mergeNodeTypeList(stored.nodeTypes, working) };
  });
  done(added.length > 0 ? `added ${added.join(', ')}` : `${NODE_TYPES.join(', ')} already exist`);

  // ── 2. author ──────────────────────────────────────────────────────────────
  step('2. create_tool + write_tool ×3');
  try {
    const created = await appToolHandlers.createTool(ctx, {
      space_id: SPACE,
      name: TOOL,
      title: 'Wayfinder',
      description: 'A goal, its waves and its task board — over context notes.',
    });
    done(`scaffolded ${created.files.join(', ')}`);
  } catch (e) {
    if (!(e instanceof McpError) || e.status !== 409) throw e;
    done(`tools/${TOOL}/ already exists — writing over it`);
  }

  const indexMd = source('index.md');
  const uiTsx = source('ui.tsx');
  const dataJs = source('data.js');
  let build = null as Awaited<ReturnType<typeof appToolHandlers.writeTool>>['build'] | null;
  for (const [file, content] of [
    ['ui.tsx', uiTsx],
    ['data.js', dataJs],
    ['index.md', indexMd],
  ] as const) {
    const written = await appToolHandlers.writeTool(ctx, { space_id: SPACE, name: TOOL, file, content });
    build = written.build;
  }
  check(
    'the working copy compiles',
    build !== null && build.ok && build.errors.length === 0 && build.config_error === null,
    build ? `${build.size_bytes} bytes · ${build.errors.join(' | ') || build.config_error || 'no errors'}` : 'no build',
  );
  if (!build?.ok) throw new Error('the tool does not compile — nothing below would mean anything');

  const checked = await appToolHandlers.checkTool(ctx, { space_id: SPACE, name: TOOL });
  console.log(`  reach ${checked.perimeter.join(' · ')}`);
  console.log(`  where ${checked.surfaces.join(' · ')}`);
  if (checked.warnings.length > 0) console.log(`  warn  ${checked.warnings.join(' | ')}`);

  // ── 3. publish + approve ───────────────────────────────────────────────────
  step('3. publish + review');
  const key = toolKey(SPACE, TOOL);
  const history = await versionHistory(key);
  const newest = history[0] ?? null;
  const newestDetail = newest ? await getVersion(newest.id) : null;
  // The WORKING COPY as the registry would snapshot it, not the files on disk:
  // the store owns a folder index's managed child block, so `tools/wayfinder/
  // index.md` is never byte-identical to examples/tools/wayfinder/index.md and
  // comparing against the file would republish on every run.
  const working = await appToolHandlers.readTool(ctx, { space_id: SPACE, name: TOOL });
  const unchanged =
    newestDetail !== null &&
    newestDetail.uiSource.trimEnd() === (working.files['ui.tsx'] ?? '').trimEnd() &&
    newestDetail.dataSource.trimEnd() === (working.files['data.js'] ?? '').trimEnd() &&
    newestDetail.indexSource.trim() === splitFrontmatter(working.files['index.md'] ?? '').body.trim();

  let versionId = newest?.id ?? null;
  if (unchanged && newest) {
    done(`v${newest.version} (${newest.status}) already carries these sources`);
  } else {
    if (newest?.status === 'pending') {
      // One pending version per key: withdraw is the author's call, but here the
      // pending row IS this script's from a previous run, so approve it first
      // and publish the new sources on top.
      const settled = await reviewVersion(newest.id, 'approved', actor, 'seed-wayfinder-tool');
      done(`approved the stale pending v${settled.ok ? settled.version.version : '?'} first`);
    }
    const published = await appToolHandlers.publishTool(ctx, {
      space_id: SPACE,
      name: TOOL,
      note: 'seed-wayfinder-tool',
    });
    versionId = published.version_id;
    done(`published v${published.version} (${published.status})`);
  }
  if (!versionId) throw new Error('nothing to review');

  const pending = (await versionHistory(key)).find((row) => row.status === 'pending');
  if (pending) {
    const reviewed = await reviewVersion(pending.id, 'approved', actor, 'seed-wayfinder-tool');
    check(
      'a super admin approves the version',
      reviewed.ok && reviewed.version.status === 'approved',
      reviewed.ok ? `v${reviewed.version.version} approved, ${reviewed.upgraded} install(s) offered it` : reviewed.error,
    );
  } else {
    done('nothing pending review');
  }

  // ── 4. install ─────────────────────────────────────────────────────────────
  step('4. install');
  let install = (await listInstalls(SPACE)).find((row) => row.key === key) ?? null;
  if (!install) {
    const installed = await appToolHandlers.installTool(ctx, { space_id: SPACE, key });
    done(`installed ${installed.slug} v${installed.version}`);
    install = (await listInstalls(SPACE)).find((row) => row.key === key) ?? null;
  } else if (install.pendingVersion) {
    const upgraded = await applyUpgrade(SPACE, install.id, actor);
    done(upgraded.ok ? `upgraded to v${upgraded.install.version}` : `upgrade refused: ${upgraded.error}`);
    install = (await listInstalls(SPACE)).find((row) => row.key === key) ?? null;
  } else {
    done(`already installed as ${install.slug} v${install.version}`);
  }
  if (!install) throw new Error('no install to carry on with');

  check(
    'the install owns both type pages and takes a rail row',
    install.typeClaims['wayfinder-project'] === 'page' && install.typeClaims['wayfinder-task'] === 'page',
    `claims ${JSON.stringify(install.typeClaims)} · degraded ${install.degraded} ${
      install.degraded ? JSON.stringify(install.requirements) : ''
    }`,
  );

  // ── 5. seed the project THROUGH THE TOOL ───────────────────────────────────
  //
  // Not through contextService: the point of this script is that the board is
  // reachable with nothing but the public mechanism, and its own data.js is the
  // only thing that knows the note layout.
  step('5. seed harness/visvine-tools through the tool');
  const targetOrError = await resolveBridgeTarget(session, { kind: 'install', installId: install.id });
  if (!('principal' in targetOrError)) {
    throw new Error(`resolveBridgeTarget refused: ${targetOrError.code} ${targetOrError.message}`);
  }
  const target: ResolvedTarget = targetOrError;

  /** One `data.call` into the Tool's isolate, refusals raised as errors. */
  async function call<T>(fn: string, args: unknown): Promise<T> {
    const response: BridgeResponse = await handleBridgeCall(target, 'data.call', { fn, args });
    if (!response.ok) throw new Error(`${fn}: ${response.error.code} — ${response.error.message}`);
    return response.value as T;
  }

  interface TaskDoc {
    path: string;
    id: string;
    title: string;
    wave: number;
    status: string;
  }
  interface Board {
    project: { name: string; path: string; title: string; waves: Array<{ n: number; title: string }> };
    tasks: TaskDoc[];
  }

  let board: Board | null = null;
  try {
    board = await call<Board>('loadProject', { project: PROJECT });
  } catch {
    board = null;
  }
  if (!board) {
    await call('createProject', {
      name: PROJECT,
      title: 'User-created Tools',
      goal: GOAL,
      brief: BRIEF,
      plan: PLAN,
      waves: WAVES,
    });
    done(`created harness/${PROJECT}/project.md`);
  } else {
    await call('saveProject', {
      project: PROJECT,
      patch: { goal: GOAL, brief: BRIEF, plan: PLAN, waves: WAVES, title: 'User-created Tools' },
    });
    done(`refreshed harness/${PROJECT}/project.md`);
  }

  board = await call<Board>('loadProject', { project: PROJECT });
  const byId = new Map(board.tasks.map((task) => [task.id, task]));
  let created = 0;
  for (const task of TASKS) {
    const existing = byId.get(task.id);
    await call('saveTask', {
      project: PROJECT,
      ...(existing ? { path: existing.path } : {}),
      patch: {
        id: task.id,
        title: task.title,
        status: task.status,
        size: task.size,
        wave: task.wave,
        depends_on: task.depends_on,
        touches: task.touches,
        task: task.task,
      },
    });
    if (!existing) created++;
  }
  done(`${created} task(s) created, ${TASKS.length - created} refreshed`);

  board = await call<Board>('loadProject', { project: PROJECT });
  check(
    'the board reads back through the tool',
    board.tasks.length === TASKS.length && board.project.waves.length === WAVES.length,
    `${board.project.title} · ${board.project.waves.length} waves · ${board.tasks.length} tasks`,
  );

  // ── 6. moving a card is a frontmatter rewrite ──────────────────────────────
  step('6. moveTask');
  const mover = board.tasks.find((task) => task.id === '026');
  if (mover) {
    await call('moveTask', { path: mover.path, wave: 5 });
    const moved = (await call<Board>('loadProject', { project: PROJECT })).tasks.find((t) => t.id === '026');
    const back = moved ? await call<{ task: TaskDoc }>('moveTask', { path: moved.path, wave: 6 }) : null;
    check(
      'a card moves between columns and back',
      moved?.wave === 5 && back?.task.wave === 6,
      `026 → wave ${moved?.wave ?? '?'} → wave ${back?.task.wave ?? '?'}`,
    );
  }

  // ── 7. the agent dispatch path, told honestly ──────────────────────────────
  //
  // `agents/` is sealed against Tool writes with one hole: CREATING the brief of
  // an agent the Tool's own perimeter names (lib/tools/bridge.ts#agentBriefExemption),
  // which is what this board declares. So Run writes the brief and then dispatches
  // — and stops at ACTIVATION, which is a space admin's act. Both halves are
  // recorded on the task note, which is what this asserts.
  step('7. runTask');
  const runnable = board.tasks.find((task) => task.id === '025');
  if (runnable) {
    const outcome = await call<{
      brief: { path: string; name: string; status: string; reason: string; text: string };
      run: { id: string; status: string; detail: string };
      task: { agent: string };
    }>('runTask', { path: runnable.path });
    check(
      'Run writes the brief it needs',
      outcome.brief.name === `wayfinder-${PROJECT}-025` &&
        (outcome.brief.status === 'written' || outcome.brief.status === 'present'),
      `brief ${outcome.brief.status} at ${outcome.brief.path}${outcome.brief.reason ? ` — ${outcome.brief.reason}` : ''}`,
    );
    check(
      'the attempt is recorded on the task note',
      outcome.run.status !== '' && outcome.task.agent === `wayfinder-${PROJECT}-025`,
      `run ${outcome.run.status}${outcome.run.id ? ` (${outcome.run.id})` : ''}${
        outcome.run.detail ? ` — ${outcome.run.detail}` : ''
      }`,
    );
    if (outcome.run.status !== 'queued') {
      console.log(
        '\n  note  A Tool writes the brief but never activates it: have an admin activate\n' +
          `        ${outcome.brief.path} (agents/live/) and set a model key, and Run will\n` +
          '        dispatch it. See docs/wayfinder-tool.md.',
      );
    }
  }

  step('done');
  console.log(`  Open the Wayfinder rail item, or /directory/note/harness/${PROJECT}/project.md`);
  console.log(`  ${failures} check(s) failed`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
