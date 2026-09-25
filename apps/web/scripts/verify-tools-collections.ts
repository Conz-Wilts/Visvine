/**
 * Live check of collections (docs/tools.md § Collections): a poll Tool holding
 * ten thousand votes, and a member deleting their account leaving none of
 * their rows.
 *
 *   1. "Poll" is written in the house and installed there; 10,000 votes go in
 *      through the bridge as two people.
 *   2. The tally counts them per answer, a page at a time reads every row
 *      once, filters match, and nothing says who voted.
 *   3. The rules hold: a schema refusal, a 16 KB row, a full collection, a
 *      vote only its voter (or an admin) changes, notes each person reads
 *      alone.
 *   4. In a real browser the Tool shows the tally, and a vote from one viewer
 *      reaches another viewer's open frame live.
 *   5. An admin exports the rows — with no author in them; a member may not.
 *   6. A throwaway member votes, then deletes their account: none of their
 *      rows are left.
 *   7. Uninstalling detaches the rows, installing again takes them back, and
 *      rows left detached past their time are purged.
 *
 * Needs `pnpm dev` and Chromium for Playwright. Cleans up after itself.
 *
 *   pnpm --filter @visvine/web verify:tools:collections
 */
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from 'playwright';
import prisma from '../lib/prisma';
import type { ActionCaller } from '../lib/actions/types';
import { appToolHandlers } from '../lib/actions/defs/apps';
import { handleBridgeCall } from '../lib/tools/bridge';
import { installVersion, uninstall } from '../lib/tools/installs';
import { toolKey } from '../lib/tools/registry';
import { resolveBridgeTarget, type ResolvedTarget } from '../lib/tools/target';
import { purgeDetachedRows } from '../lib/tools/collections';
import { deleteAccount } from '../lib/account/deleteAccount';
import type { BridgeMethod, BridgeResponse, CollectionRow } from '../lib/tools/protocol';
import { SPACE_ID } from './seed/space';

const HOUSE = SPACE_ID;
const TOOL = 'vg-poll';
const VOTES = 10_000;
const VOTER_EMAIL = 'vg-poll-voter@local.dev';
const APP = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tools', 'collections');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, detail: string): boolean {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n        ${detail}`);
  return ok;
}
function step(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(1, 58 - title.length))}`);
}

type Person = { id: string; name: string; email: string };

async function targetFor(person: Person, installId: string): Promise<ResolvedTarget> {
  const t = await resolveBridgeTarget({ userId: person.id, name: person.name, email: person.email }, { kind: 'install', installId });
  if ('code' in t) throw new Error(`${person.email}: ${t.code} ${t.message}`);
  return t;
}

async function call<T>(t: ResolvedTarget, method: BridgeMethod, params: unknown): Promise<{ ok: true; value: T } | { ok: false; code: string; message: string }> {
  const response: BridgeResponse = await handleBridgeCall(t, method, params);
  return response.ok ? { ok: true, value: response.value as T } : { ok: false, code: response.error.code, message: response.error.message };
}

async function login(browser: Browser, userId: string): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  const res = await page.goto(`${APP}/dev/login`, { waitUntil: 'domcontentloaded' });
  if (res?.status() === 404) throw new Error('/dev/login is 404 — set NODE_ENV=development and ENABLE_DEV_AUTH=true');
  await page.locator(`form[action^="/api/dev/login-as/${userId}"] button`).first().click();
  await page.waitForURL((url) => !url.pathname.startsWith('/dev/login'), { timeout: 30_000 });
  await page.close();
  return context;
}

async function toolFrame(page: Page): Promise<Frame> {
  await page.waitForSelector('iframe', { state: 'attached', timeout: 30_000 });
  for (let i = 0; i < 80; i++) {
    const frame = page.frames().find((f) => f.url().includes('/api/tools/runtime/frame'));
    if (frame) return frame;
    await page.waitForTimeout(250);
  }
  throw new Error('no tool frame on the page');
}

async function openTool(context: BrowserContext, slug: string): Promise<{ page: Page; frame: Frame }> {
  const page = await context.newPage();
  await page.goto(`${APP}/s/${HOUSE}/t/${slug}`, { waitUntil: 'domcontentloaded' });
  const frame = await toolFrame(page);
  await frame.getByTestId('total').filter({ hasText: 'votes' }).waitFor({ timeout: 45_000 });
  return { page, frame };
}

async function cleanup(): Promise<void> {
  const key = toolKey(HOUSE, TOOL);
  const installs = await prisma.appToolInstall.findMany({ where: { key }, select: { id: true } });
  await prisma.appToolRecord.deleteMany({ where: { OR: [{ toolKey: key }, { targetKey: { in: installs.map((i) => i.id) } }, { targetKey: `preview:${HOUSE}/${TOOL}` }] } });
  await prisma.appToolInstall.deleteMany({ where: { key } });
  await prisma.appToolVersion.deleteMany({ where: { key } });
  await prisma.appToolListing.deleteMany({ where: { key } });
  await prisma.contextNote.deleteMany({ where: { spaceId: HOUSE, OR: [{ path: { startsWith: `tools/${TOOL}/` } }, { deletedPath: { startsWith: `tools/${TOOL}/` } }] } });
  await prisma.appToolBuild.deleteMany({ where: { spaceId: HOUSE, name: TOOL } });
  await prisma.appToolConfig.deleteMany({ where: { spaceId: HOUSE, name: TOOL } });
  await prisma.appToolCheckRun.deleteMany({ where: { spaceId: HOUSE, name: TOOL } });
  await prisma.node.deleteMany({ where: { id: `tool:${TOOL}`, spaceId: HOUSE } });
  const voter = await prisma.user.findUnique({ where: { email: VOTER_EMAIL }, select: { id: true } });
  if (voter) await deleteAccount(voter.id).catch(() => prisma.user.delete({ where: { id: voter.id } }).catch(() => undefined));
}

async function main(): Promise<void> {
  const adminRow = await prisma.user.findFirst({ where: { email: 'admin@local.dev' }, select: { id: true, name: true, email: true } });
  const memberRow = await prisma.user.findFirst({ where: { email: 'member@local.dev' }, select: { id: true, name: true, email: true } });
  if (!adminRow || !memberRow) throw new Error('admin@local.dev and member@local.dev must be seeded');
  const admin: Person = { id: adminRow.id, name: adminRow.name, email: adminRow.email };
  const member: Person = { id: memberRow.id, name: memberRow.name, email: memberRow.email };
  const actor = { userId: admin.id, email: admin.email };
  const ctx: ActionCaller = {
    userId: admin.id,
    name: admin.name,
    email: admin.email,
    scopes: ['context:read', 'context:write', 'tools:author', 'tools:install'],
  };
  console.log(`house   ${HOUSE}\nadmin   ${admin.email}\nmember  ${member.email}\napp     ${APP}`);
  await cleanup();

  let browser: Browser | null = null;
  try {
    // ── 1. ten thousand votes ─────────────────────────────────────────────────
    step('1. Poll is installed and takes 10,000 votes');
    await appToolHandlers.createTool(ctx, { space_id: HOUSE, name: TOOL, title: 'Poll', description: 'Poll' });
    await appToolHandlers.writeTool(ctx, { space_id: HOUSE, name: TOOL, file: 'index.md', content: fixture('poll-index.md') });
    const built = await appToolHandlers.writeTool(ctx, { space_id: HOUSE, name: TOOL, file: 'ui.tsx', content: fixture('poll-ui.tsx') });
    const published = await appToolHandlers.publishTool(ctx, { space_id: HOUSE, name: TOOL, release_notes: 'First.' });
    const installed = await installVersion(HOUSE, published.version_id, actor);
    check('it compiles, publishes and installs', built.build.ok && installed.ok, `${built.build.ok} · ${installed.ok ? installed.install.slug : installed.error}`);
    if (!installed.ok) throw new Error('install failed');
    const installId = installed.install.id;
    const asAdmin = await targetFor(admin, installId);
    const asMember = await targetFor(member, installId);

    const started = Date.now();
    const choices = ['a', 'b', 'c'] as const;
    let refused = 0;
    for (let at = 0; at < VOTES; at += 50) {
      const batch = Array.from({ length: Math.min(50, VOTES - at) }, (_, i) => at + i);
      const answers = await Promise.all(
        batch.map((n) => call<CollectionRow>(n % 2 === 0 ? asAdmin : asMember, 'collections.insert', { collection: 'votes', data: { choice: choices[n % 3] } })),
      );
      refused += answers.filter((a) => !a.ok).length;
    }
    const held = await prisma.appToolRecord.count({ where: { targetKey: installId, collection: 'votes' } });
    check('10,000 votes through the bridge, as two people', held === VOTES && refused === 0, `${held} rows, ${refused} refused, ${Math.round((Date.now() - started) / 1000)}s`);

    // ── 2. reading them ───────────────────────────────────────────────────────
    step('2. the tally, the pages, the filters');
    const t0 = Date.now();
    const tally = await call<{ total: number; groups?: Array<{ value: string | null; count: number }> }>(asMember, 'collections.count', { collection: 'votes', groupBy: 'choice' });
    const tallyMs = Date.now() - t0;
    const expected = { a: Math.ceil(VOTES / 3), b: Math.ceil((VOTES - 1) / 3), c: Math.floor(VOTES / 3) };
    const groups = tally.ok ? Object.fromEntries((tally.value.groups ?? []).map((g) => [g.value, g.count])) : {};
    check(
      'the tally counts every vote per answer',
      tally.ok && tally.value.total === VOTES && groups.a === expected.a && groups.b === expected.b && groups.c === expected.c,
      `${JSON.stringify(groups)} of ${tally.ok ? tally.value.total : tally.message} in ${tallyMs}ms`,
    );
    const mine = await call<{ total: number }>(asMember, 'collections.count', { collection: 'votes', mine: true });
    const onlyB = await call<{ total: number }>(asMember, 'collections.count', { collection: 'votes', where: { choice: 'b' } });
    check('mine and where narrow it', mine.ok && mine.value.total === VOTES / 2 && onlyB.ok && onlyB.value.total === expected.b, `${mine.ok ? mine.value.total : mine.message} mine · ${onlyB.ok ? onlyB.value.total : onlyB.message} b`);

    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    let sawAuthor = false;
    let mineRows = 0;
    const p0 = Date.now();
    do {
      type Page = { rows: CollectionRow[]; nextCursor: string | null };
      const page: { ok: true; value: Page } | { ok: false; code: string; message: string } = await call<Page>(asMember, 'collections.list', {
        collection: 'votes',
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      if (!page.ok) throw new Error(page.message);
      for (const row of page.value.rows) {
        seen.add(row.id);
        if (row.mine) mineRows += 1;
        if (JSON.stringify(row).includes(admin.id) || JSON.stringify(row).includes(member.id)) sawAuthor = true;
      }
      cursor = page.value.nextCursor;
      pages += 1;
    } while (cursor && pages < 100);
    check('a page at a time reads every row exactly once', seen.size === VOTES && pages === VOTES / 200, `${seen.size} rows in ${pages} pages, ${Date.now() - p0}ms`);
    check('no row says who wrote it; mine marks the viewer’s own', !sawAuthor && mineRows === VOTES / 2, `${mineRows} mine, author ${sawAuthor ? 'SHOWN' : 'never shown'}`);
    const desc = await call<{ rows: CollectionRow[] }>(asAdmin, 'collections.list', { collection: 'votes', order: 'desc', limit: 1 });
    const newest = await prisma.appToolRecord.findFirst({ where: { targetKey: installId, collection: 'votes' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } });
    check('desc starts at the newest', desc.ok && desc.value.rows[0]?.id === newest?.id, desc.ok ? desc.value.rows[0]?.id ?? 'none' : desc.message);

    // ── 3. the rules ──────────────────────────────────────────────────────────
    step('3. schema, size, quota and who may change what');
    const wrong = await call(asMember, 'collections.insert', { collection: 'votes', data: { choice: 'z' } });
    const extra = await call(asMember, 'collections.insert', { collection: 'votes', data: { choice: 'a', voter: 'ada' } });
    check('a vote outside the schema is refused', !wrong.ok && wrong.code === 'invalid' && !extra.ok && extra.code === 'invalid', `${!wrong.ok ? wrong.message : 'stored!'} · ${!extra.ok ? extra.message : 'stored!'}`);
    const big = await call(asMember, 'collections.insert', { collection: 'notes', data: { text: 'x'.repeat(17_000) } });
    check('a row over 16 KB is refused', !big.ok && big.code === 'invalid' && /16 KB/.test(big.message), !big.ok ? big.message : 'stored!');
    const undeclared = await call(asMember, 'collections.insert', { collection: 'ballots', data: {} });
    check('a collection the Tool never declared is its perimeter', !undeclared.ok && undeclared.code === 'perimeter', !undeclared.ok ? undeclared.message : 'stored!');
    const pins = [];
    for (let i = 0; i < 4; i++) pins.push(await call(asMember, 'collections.insert', { collection: 'pins', data: { at: i } }));
    const fourth = pins[3];
    check('a full collection refuses the next row', pins.slice(0, 3).every((p) => p.ok) && !fourth.ok && fourth.code === 'too_large', !fourth.ok ? fourth.message : 'stored!');

    const adminVote = await call<CollectionRow>(asAdmin, 'collections.insert', { collection: 'votes', data: { choice: 'a' } });
    const memberVote = await call<CollectionRow>(asMember, 'collections.insert', { collection: 'votes', data: { choice: 'b' } });
    if (!adminVote.ok || !memberVote.ok) throw new Error('could not vote');
    const theirs = await call(asMember, 'collections.update', { collection: 'votes', id: adminVote.value.id, data: { choice: 'c' } });
    const theirsGone = await call(asMember, 'collections.delete', { collection: 'votes', id: adminVote.value.id });
    check('write: own — a member cannot change or remove another person’s vote', !theirs.ok && theirs.code === 'forbidden' && !theirsGone.ok && theirsGone.code === 'forbidden', `${!theirs.ok ? theirs.message : 'changed!'}`);
    const own = await call<CollectionRow>(asMember, 'collections.update', { collection: 'votes', id: memberVote.value.id, data: { choice: 'c' } });
    const byAdmin = await call(asAdmin, 'collections.delete', { collection: 'votes', id: memberVote.value.id });
    const ownGone = await call(asAdmin, 'collections.delete', { collection: 'votes', id: adminVote.value.id });
    check('their own vote they change; an admin removes anyone’s', own.ok && own.value.data.choice === 'c' && own.value.mine && byAdmin.ok && ownGone.ok, `${own.ok ? own.value.data.choice : own.message} · ${byAdmin.ok} · ${ownGone.ok}`);

    await call(asAdmin, 'collections.insert', { collection: 'notes', data: { text: 'the admin’s note' } });
    await call(asMember, 'collections.insert', { collection: 'notes', data: { text: 'the member’s note' } });
    await call(asMember, 'collections.insert', { collection: 'notes', data: { text: 'another', mood: null } });
    const memberNotes = await call<{ rows: CollectionRow<{ text: string }>[] }>(asMember, 'collections.list', { collection: 'notes' });
    const adminNotes = await call<{ rows: CollectionRow<{ text: string }>[] }>(asAdmin, 'collections.list', { collection: 'notes' });
    const peek = memberNotes.ok ? memberNotes.value.rows : [];
    const adminsNote = await prisma.appToolRecord.findFirst({ where: { targetKey: installId, collection: 'notes', userId: admin.id }, select: { id: true } });
    const direct = adminsNote ? await call(asMember, 'collections.get', { collection: 'notes', id: adminsNote.id }) : { ok: true as const, value: null };
    check(
      'read: own — a member reads only their own notes, an admin reads all',
      memberNotes.ok && peek.length === 2 && peek.every((r) => r.mine) && adminNotes.ok && adminNotes.value.rows.length === 3 && !direct.ok && direct.code === 'not_found',
      `member ${peek.length}, admin ${adminNotes.ok ? adminNotes.value.rows.length : adminNotes.message}, another’s by id: ${direct.ok ? 'READ' : direct.code}`,
    );
    const nulls = await call<{ rows: CollectionRow[] }>(asAdmin, 'collections.list', { collection: 'notes', where: { mood: null } });
    const nullCount = await call<{ total: number; groups?: Array<{ value: string | null; count: number }> }>(asAdmin, 'collections.count', { collection: 'notes', where: { mood: null }, groupBy: 'mood' });
    check(
      'null matches a field set to null or absent, in a list and a count alike',
      nulls.ok && nulls.value.rows.length === 3 && nullCount.ok && nullCount.value.total === 3 && nullCount.value.groups?.[0]?.count === 3,
      `${nulls.ok ? nulls.value.rows.length : nulls.message} listed · ${nullCount.ok ? JSON.stringify(nullCount.value) : nullCount.message}`,
    );

    // ── 4. in the browser ─────────────────────────────────────────────────────
    step('4. the Tool shows the tally, and a vote reaches another viewer live');
    browser = await chromium.launch({ headless: true });
    const memberCtx = await login(browser, member.id);
    const adminCtx = await login(browser, admin.id);
    const watching = await openTool(adminCtx, installed.install.slug);
    const voting = await openTool(memberCtx, installed.install.slug);
    const before = (await voting.frame.getByTestId('total').textContent()) ?? '';
    const beforeA = Number((await voting.frame.getByTestId('tally-a').textContent()) ?? '0');
    check('the frame draws the tally of 10,000', before === `${VOTES} votes` && beforeA === expected.a, `${before}, a: ${beforeA}`);
    const clicked = Date.now();
    await voting.frame.getByRole('button', { name: 'Vote A' }).click();
    await voting.frame.getByTestId('total').filter({ hasText: `${VOTES + 1} votes` }).waitFor({ timeout: 10_000 });
    await watching.frame.getByTestId('total').filter({ hasText: `${VOTES + 1} votes` }).waitFor({ timeout: 10_000 });
    const liveMs = Date.now() - clicked;
    const watchedA = Number((await watching.frame.getByTestId('tally-a').textContent()) ?? '0');
    check('a member’s vote reaches the admin’s open frame without a reload', watchedA === expected.a + 1 && liveMs < 10_000, `a: ${watchedA} after ${liveMs}ms`);

    // ── 5. export ─────────────────────────────────────────────────────────────
    step('5. an admin exports the rows; a member may not');
    const url = `${APP}/api/spaces/${HOUSE}/tools/${installId}/records`;
    const exported = await adminCtx.request.get(url);
    const body = exported.ok() ? await exported.text() : '';
    const parsed = body ? (JSON.parse(body) as { collections: Record<string, unknown[]> }) : { collections: {} };
    check(
      'the export holds every row and never an author',
      exported.ok() && (parsed.collections.votes?.length ?? 0) === VOTES + 1 && !body.includes(admin.id) && !body.includes(member.id) && !body.includes(member.email),
      `${exported.status()} · votes ${parsed.collections.votes?.length ?? 0} · notes ${parsed.collections.notes?.length ?? 0} · ${(body.length / 1024).toFixed(0)} KB · ${exported.headers()['content-disposition'] ?? ''}`,
    );
    const denied = await memberCtx.request.get(url);
    check('a member is refused', denied.status() === 403, String(denied.status()));

    // ── 6. an account deleted ─────────────────────────────────────────────────
    step('6. a member votes, then deletes their account');
    const voterRow = await prisma.user.create({ data: { email: VOTER_EMAIL, name: 'Poll Voter' }, select: { id: true, name: true, email: true } });
    await prisma.spaceMember.create({ data: { userId: voterRow.id, spaceId: HOUSE, status: 'active' } });
    const voter: Person = voterRow;
    const asVoter = await targetFor(voter, installId);
    for (let i = 0; i < 5; i++) await call(asVoter, 'collections.insert', { collection: 'votes', data: { choice: choices[i % 3] } });
    await call(asVoter, 'collections.insert', { collection: 'notes', data: { text: 'mine alone' } });
    const theirsBefore = await prisma.appToolRecord.count({ where: { userId: voter.id } });
    const totalBefore = await prisma.appToolRecord.count({ where: { targetKey: installId } });
    await deleteAccount(voter.id);
    const theirsAfter = await prisma.appToolRecord.count({ where: { userId: voter.id } });
    const totalAfter = await prisma.appToolRecord.count({ where: { targetKey: installId } });
    check('none of their rows are left, and nobody else’s went', theirsBefore === 6 && theirsAfter === 0 && totalAfter === totalBefore - 6, `${theirsBefore} → ${theirsAfter} theirs · ${totalBefore} → ${totalAfter} in all`);

    // ── 7. uninstall, reinstall, purge ────────────────────────────────────────
    step('7. uninstalling keeps the rows for a reinstall; past their time they go');
    const heldBefore = await prisma.appToolRecord.count({ where: { targetKey: installId } });
    const gone = await uninstall(HOUSE, installId, actor);
    const detached = await prisma.appToolRecord.count({ where: { toolKey: toolKey(HOUSE, TOOL), detachedAt: { not: null } } });
    check('uninstalled, its rows are detached, not dropped', gone.ok && detached === heldBefore, `${detached} of ${heldBefore} detached`);
    const again = await installVersion(HOUSE, published.version_id, actor);
    if (!again.ok) throw new Error(again.error);
    const retally = await call<{ total: number }>(await targetFor(member, again.install.id), 'collections.count', { collection: 'votes' });
    check('installed again, it takes them back', retally.ok && retally.value.total === VOTES + 1, `${retally.ok ? retally.value.total : retally.message} votes`);
    await purgeDetachedRows();
    const kept = await prisma.appToolRecord.count({ where: { targetKey: again.install.id } });
    const removed = await uninstall(HOUSE, again.install.id, actor);
    const early = await purgeDetachedRows(new Date(Date.now() + 29 * 86_400_000));
    const late = await purgeDetachedRows(new Date(Date.now() + 31 * 86_400_000));
    check('a purge spares attached rows and ones inside 30 days, and takes the rest', removed.ok && kept === heldBefore && early === 0 && late === heldBefore, `kept ${kept} · at 29 days ${early} · at 31 days ${late}`);
  } finally {
    await browser?.close();
    await cleanup();
    await prisma.$disconnect();
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
