/**
 * Live check of manifest 2 and bridge v2: a Tool that names the KIND of thing
 * it needs installs into a space that files deals in another folder under
 * another type, is bound there, and works — through the bridge and in the
 * browser, on kit 2 — while a kit-1 Tool beside it runs on kit 1.
 *
 *   1. The house (the seed space) keeps deals as `VfDeal` notes in `vf-deals/`;
 *      a room keeps them as `VfOpportunity` notes in `vf-pipeline/`.
 *   2. An admin writes "Deal Flow" in the house — bindings, permissions,
 *      settings, a module, a curated dependency — checks and publishes it.
 *   3. In the house every slot takes its suggestion; in the room the type has
 *      no match, so the install runs degraded until bind_tool binds it.
 *   4. The bridge, as the room's admin: the bound type answers and the house's
 *      name does not; the bound folder is readable and the house's is not;
 *      a field edit lands and one outside the declaration is refused;
 *      actions.run works here and is refused naming the house; state is per
 *      viewer by default.
 *   5. The frame: kit 2 and its stylesheet for this Tool, kit 1 for a Tool
 *      written without `sdk`; in the browser the rows render with the app's
 *      own button.
 *   6. Shared down into another room, the install binds to what that room has.
 *
 * Needs `pnpm dev` and Chromium for Playwright. Cleans up after itself.
 *
 *   pnpm --filter @visvine/web verify:tools:bindings
 */
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import prisma from '../lib/prisma';
import * as store from '../lib/notes/store';
import { writeGated } from '../lib/notes/contextService';
import { principalOf, resolveContext } from '../lib/notes/resolve';
import { ADMIN_ALIAS_ID, type NodeTypeConfig } from '../lib/types/context';
import { addTrackedField } from '../lib/directory/table';
import { runAction } from '../lib/actions/run';
import { ActionError, type ActionCaller } from '../lib/actions/types';
import { appToolHandlers } from '../lib/actions/defs/apps';
import { handleBridgeCall } from '../lib/tools/bridge';
import { toolRailKey } from '../lib/featureAccess';
import { toolFolderPath, toolIndexPath } from '../lib/tools/config';
import { mintFrameToken } from '../lib/tools/frameToken';
import { listInstalls } from '../lib/tools/installs';
import type { BridgeMethod, BridgeResponse } from '../lib/tools/protocol';
import { reviewVersion, toolKey } from '../lib/tools/registry';
import { requestListing } from '../lib/tools/listings';
import { runReviewNow } from '../lib/tools/review/run';
import { giveConsent } from '../lib/tools/consents';
import { actingReachOf } from '../lib/tools/shared/listing';
import { toolActionActs } from '../lib/tools/actionAllowlist';
import { resolveBridgeTarget, type ResolvedTarget } from '../lib/tools/target';
import { readSpaceConfig, updateSpaceConfig } from '../lib/spaces/spaceConfig';
import { reprojectTypes } from '../lib/records/projection';
import { SPACE_ID } from './seed/space';

const HOUSE = SPACE_ID;
const ROOM = 'programs';
const SHARE_ROOM = 'fund-operations';
const TOOL = 'deal-flow';
const LEGACY = 'deal-flow-legacy';
const HOUSE_TYPE = 'VfDeal';
const ROOM_TYPE = 'VfOpportunity';
const HOUSE_FOLDER = 'vf-deals';
const ROOM_FOLDER = 'vf-pipeline';
const APP = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const TOOLS = (process.env.TOOLS_ORIGIN || 'http://127.0.0.1:3000').replace(/\/$/, '');
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tools', TOOL);

const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const shared = (spaceId: string): store.Context => ({ spaceId, ownerKey: store.SHARED_OWNER_KEY });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

function record(type: string, title: string, fields: Record<string, string | number>): string {
  return ['---', `type: ${type}`, `title: "${title}"`, ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), '---', '', `${title}.`, ''].join('\n');
}

const HOUSE_NOTES: Record<string, string> = {
  [`${HOUSE_FOLDER}/northwind.md`]: record(HOUSE_TYPE, 'Northwind', { stage: 'Lead', amount: 4000 }),
};
const ROOM_NOTES: Record<string, string> = {
  [`${ROOM_FOLDER}/acme.md`]: record(ROOM_TYPE, 'Acme', { stage: 'Lead', amount: 12000 }),
  [`${ROOM_FOLDER}/globex.md`]: record(ROOM_TYPE, 'Globex', { stage: 'Won', amount: 5000 }),
};

/** An invented type with Stage and Amount, as a space admin would add it. */
async function addType(caller: ActionCaller, spaceId: string, name: string): Promise<void> {
  await runAction(caller, 'add_type', { space_id: spaceId, name }).catch(() => undefined);
  await updateSpaceConfig(spaceId, (stored) => ({
    nodeTypes: (stored.nodeTypes ?? []).map((t): NodeTypeConfig => {
      if (t.name !== name) return t;
      let next = t;
      for (const field of [
        { label: 'Stage', kind: 'select' as const, options: ['Lead', 'Won', 'Lost'] },
        { label: 'Amount', kind: 'number' as const },
      ]) {
        const added = addTrackedField(next, field);
        if (added.ok) next = added.config;
      }
      return next;
    }),
  }));
  await reprojectTypes(spaceId, [name]);
}

async function dropType(spaceId: string, name: string): Promise<void> {
  await updateSpaceConfig(spaceId, (stored) => ({ nodeTypes: (stored.nodeTypes ?? []).filter((t) => t.name !== name) }));
  await prisma.contextRecordField.deleteMany({ where: { spaceId, type: name } });
  await prisma.contextRecord.deleteMany({ where: { spaceId, type: name } });
}

async function dropNotes(spaceId: string, paths: string[], folders: string[]): Promise<void> {
  for (const path of paths) await store.deleteNote(shared(spaceId), path).catch(() => undefined);
  await prisma.contextNote.deleteMany({
    where: { spaceId, OR: [{ path: { in: paths } }, ...folders.map((f) => ({ path: { startsWith: `${f}/` } })), ...folders.map((f) => ({ deletedPath: { startsWith: `${f}/` } }))] },
  });
  await prisma.contextFolder.deleteMany({ where: { spaceId, path: { in: folders } } });
}

/** Take a Tool back out of every space it reached: installs, versions, builds, notes, facts, node, rail keys. */
async function dropTool(name: string): Promise<void> {
  const key = toolKey(HOUSE, name);
  const installs = await prisma.appToolInstall.findMany({ where: { key }, select: { spaceId: true, slug: true } });
  await prisma.appToolInstall.deleteMany({ where: { key } });
  await prisma.appToolCheckRun.deleteMany({ where: { spaceId: HOUSE, name } });
  await prisma.appToolVersion.deleteMany({ where: { key } });
  await prisma.appToolListing.deleteMany({ where: { key } });
  const folder = toolFolderPath(name);
  const notes = await prisma.contextNote.findMany({ where: { spaceId: HOUSE, path: { startsWith: `${folder}/` }, deletedAt: null }, select: { path: true } });
  for (const note of notes) await store.deleteNote(shared(HOUSE), note.path).catch(() => undefined);
  await prisma.appToolBuild.deleteMany({ where: { spaceId: HOUSE, name } });
  await prisma.contextNote.deleteMany({ where: { spaceId: HOUSE, OR: [{ path: { startsWith: `${folder}/` } }, { deletedPath: { startsWith: `${folder}/` } }] } });
  await prisma.contextFolder.deleteMany({ where: { spaceId: HOUSE, path: { startsWith: folder } } });
  await prisma.appToolConfig.deleteMany({ where: { spaceId: HOUSE, name } });
  await prisma.appToolConfigChange.deleteMany({ where: { spaceId: HOUSE, name } });
  await prisma.node.deleteMany({ where: { id: `tool:${name}`, spaceId: HOUSE } });
  for (const { spaceId, slug } of installs) {
    const railKey = toolRailKey(slug);
    await updateSpaceConfig(spaceId, (stored) => {
      const current = stored.featureConfig ?? {};
      const without = (list: string[] | undefined) => list?.filter((entry) => entry !== railKey);
      return {
        featureConfig: {
          ...current,
          ...(current.order ? { order: without(current.order) } : {}),
          ...(current.more ? { more: without(current.more) } : {}),
          ...(current.enabled ? { enabled: Object.fromEntries(Object.entries(current.enabled).filter(([k]) => k !== railKey)) } : {}),
        },
      };
    });
  }
}

async function cleanup(orders: Map<string, boolean>): Promise<void> {
  await dropTool(TOOL);
  await dropTool(LEGACY);
  await dropNotes(HOUSE, Object.keys(HOUSE_NOTES), [HOUSE_FOLDER]);
  await dropNotes(ROOM, Object.keys(ROOM_NOTES), [ROOM_FOLDER]);
  await dropType(HOUSE, HOUSE_TYPE);
  await dropType(ROOM, ROOM_TYPE);
  for (const [spaceId, absent] of orders) {
    if (!absent) continue;
    await updateSpaceConfig(spaceId, (stored) => {
      const next = { ...(stored.featureConfig ?? {}) };
      delete next.order;
      return { featureConfig: next };
    });
  }
}

async function outcome<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; status: number; message: string }> {
  try {
    return { ok: true, value: await run() };
  } catch (e) {
    if (e instanceof ActionError) return { ok: false, status: e.status, message: e.message };
    throw e;
  }
}

function describe(response: BridgeResponse): string {
  return response.ok ? JSON.stringify(response.value).slice(0, 160) : `${response.error.code}: ${response.error.message}`;
}

async function login(browser: Browser, userId: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const res = await page.goto(`${APP}/dev/login`, { waitUntil: 'domcontentloaded' });
  if (res?.status() === 404) throw new Error('/dev/login is 404 — set NODE_ENV=development and ENABLE_DEV_AUTH=true');
  await page.locator(`form[action^="/api/dev/login-as/${userId}"] button`).first().click();
  await page.waitForURL((url) => !url.pathname.startsWith('/dev/login'), { timeout: 30_000 });
  return { context, page };
}

async function main(): Promise<void> {
  const holder = await prisma.userAlias.findFirst({
    where: { spaceId: HOUSE, aliasId: ADMIN_ALIAS_ID, user: { email: { endsWith: '@local.dev' } } },
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  const admin = holder?.user;
  if (!admin) throw new Error(`nobody on /dev/login manages ${HOUSE}`);
  const member = await prisma.user.findFirst({ where: { email: 'member@local.dev' }, select: { id: true, name: true, email: true } });
  if (!member) throw new Error('member@local.dev is not seeded');
  const ctx: ActionCaller = {
    userId: admin.id,
    name: admin.name ?? '',
    email: admin.email ?? '',
    scopes: ['context:read', 'context:write', 'tools:author', 'tools:install'],
  };
  const session = { userId: admin.id, name: admin.name ?? '', email: admin.email ?? '' };
  const actor = { id: admin.id, name: admin.name ?? 'admin', email: admin.email };
  console.log(`house   ${HOUSE}\nroom    ${ROOM}\nadmin   ${admin.email}\napp     ${APP}`);

  const orders = new Map<string, boolean>();
  for (const spaceId of [HOUSE, ROOM, SHARE_ROOM]) orders.set(spaceId, (await readSpaceConfig(spaceId))?.featureConfig.order === undefined);
  await cleanup(new Map());

  let browser: Browser | null = null;
  try {
    // ── 1. two spaces, two shapes ─────────────────────────────────────────────
    step('1. the house and the room keep deals differently');
    await addType(ctx, HOUSE, HOUSE_TYPE);
    await addType(ctx, ROOM, ROOM_TYPE);
    for (const [path, body] of Object.entries(HOUSE_NOTES)) await store.writeNote(shared(HOUSE), path, body, actor);
    for (const [path, body] of Object.entries(ROOM_NOTES)) await store.writeNote(shared(ROOM), path, body, actor);
    const counts = await Promise.all([
      prisma.contextRecord.count({ where: { spaceId: HOUSE, type: HOUSE_TYPE } }),
      prisma.contextRecord.count({ where: { spaceId: ROOM, type: ROOM_TYPE } }),
    ]);
    check('the house has VfDeal records in vf-deals/, the room VfOpportunity ones in vf-pipeline/', counts[0] === 1 && counts[1] === 2, `${counts[0]} · ${counts[1]}`);

    // ── 2. the Tool, written once ─────────────────────────────────────────────
    step('2. Deal Flow — bindings, permissions, settings, a module, a dependency');
    await appToolHandlers.createTool(ctx, { space_id: HOUSE, name: TOOL, title: 'Deal Flow', description: 'Deals' });
    let written = await appToolHandlers.writeTool(ctx, { space_id: HOUSE, name: TOOL, file: 'index.md', content: fixture('index.md') });
    written = await appToolHandlers.writeTool(ctx, { space_id: HOUSE, name: TOOL, file: 'src/format.ts', content: fixture('format.ts') });
    written = await appToolHandlers.writeTool(ctx, { space_id: HOUSE, name: TOOL, file: 'ui.tsx', content: fixture('ui.tsx') });
    check('the index, the module and ui.tsx compile together', written.build.ok, written.build.errors.join(' | ') || 'no errors');
    const facts = await prisma.appToolConfig.findUnique({ where: { app_tool_config_identity: { spaceId: HOUSE, name: TOOL } }, select: { facts: true } });
    const indexNote = await store.readNoteOrNull(shared(HOUSE), toolIndexPath(TOOL));
    check(
      'the manifest\'s facts are the row; the note keeps the prose',
      !!facts && JSON.stringify(facts.facts).includes('$deals/**') && !!indexNote && !indexNote.includes('permissions:'),
      Object.keys((facts?.facts as object) ?? {}).join(', '),
    );
    // A person in the note editor, not the tool service: the facts are the row's.
    const resolvedHouse = await resolveContext(session, HOUSE);
    if (resolvedHouse instanceof Response) throw new Error(`resolveContext: ${resolvedHouse.status}`);
    const widened = await writeGated(
      await principalOf(resolvedHouse),
      shared(HOUSE),
      toolIndexPath(TOOL),
      (indexNote ?? '').replace('type: tool', 'type: tool\npermissions:\n  context: { read: ["**"] }'),
      'edit',
    );
    check(
      'a plain note write cannot add reach to the index — the facts are the row\'s',
      widened.status === 'denied' && /configure_tool/.test(widened.reason),
      widened.status === 'denied' ? widened.reason : 'written',
    );
    const checked = await appToolHandlers.checkTool(ctx, { space_id: HOUSE, name: TOOL });
    check('check_tool: ready to publish, nothing missing in the house', checked.ready_to_publish && checked.requirements.missing.length === 0, `${checked.checks.blocking.length} blocking · missing [${checked.requirements.missing.join(', ')}]`);
    const read = await appToolHandlers.readTool(ctx, { space_id: HOUSE, name: TOOL });
    check('read_tool hands back the module beside the sources', typeof read.files['src/format.ts'] === 'string', Object.keys(read.files).join(', '));
    const published = await appToolHandlers.publishTool(ctx, { space_id: HOUSE, name: TOOL, note: 'verify-tools-bindings' });
    const version = await prisma.appToolVersion.findUnique({ where: { id: published.version_id }, select: { modules: true } });
    const bumpedNote = await store.readNoteOrNull(shared(HOUSE), toolIndexPath(TOOL));
    check(
      'published and approved, the module snapshotted with it, the version recorded in the note',
      published.status === 'approved' && JSON.stringify(version?.modules ?? {}).includes('money') && !('warning' in published) && /version: 1/.test(bumpedNote ?? ''),
      `${published.key} v${published.version}${'warning' in published ? ` · ${String((published as { warning?: string }).warning)}` : ''}`,
    );

    // A room is another space: it runs the house's Tool when the house shares
    // it down (step 6) or when the Tool is listed. List it, through the review
    // a Visvine reviewer gives.
    const reviewer = (process.env.SUPER_ADMIN_EMAILS ?? '').split(',').map((e) => e.trim()).find(Boolean);
    if (!reviewer) throw new Error('SUPER_ADMIN_EMAILS is empty — no reviewer to list the Tool');
    const submitted = await requestListing(published.version_id, { userId: admin.id, email: admin.email ?? '', spaceId: HOUSE, isAdmin: true }, { license: 'MIT' });
    // Visvine's own stages (verify-tools-global.ts covers them); this one only needs the listing.
    await runReviewNow(published.version_id, { runner: { unavailable: 'not part of this check' } });
    const reviewed = await reviewVersion(published.version_id, 'approved', { userId: admin.id, email: reviewer });
    check('listed for other spaces, through submission and review', submitted.ok && reviewed.ok, `${submitted.ok ? 'submitted' : submitted.error} · ${reviewed.ok ? 'approved' : reviewed.error}`);

    // ── 3. installs ───────────────────────────────────────────────────────────
    step('3. bound in the house by suggestion, in the room by choice');
    await appToolHandlers.installTool(ctx, { space_id: HOUSE, version_id: published.version_id });
    const houseInstall = (await listInstalls(HOUSE)).find((row) => row.key === toolKey(HOUSE, TOOL));
    check(
      'in the house every slot is its own suggestion, and nothing is missing',
      !!houseInstall && houseInstall.bindings.deals === HOUSE_FOLDER && houseInstall.bindings.deal === HOUSE_TYPE && !houseInstall.degraded,
      JSON.stringify(houseInstall?.bindings),
    );
    const roomFirst = await appToolHandlers.installTool(ctx, { space_id: ROOM, version_id: published.version_id });
    check(
      'in the room the house\'s type means nothing: the slot is unbound and the Tool degraded',
      roomFirst.requirements.degraded && roomFirst.requirements.missing.includes('Deal type is not bound'),
      roomFirst.requirements.missing.join(' · '),
    );
    const refusedBind = await outcome(() => appToolHandlers.bindTool(ctx, { space_id: ROOM, tool: TOOL, bindings: { deal: HOUSE_TYPE } }));
    check('binding a type the room does not have is refused', !refusedBind.ok && refusedBind.status === 400, refusedBind.ok ? 'accepted' : refusedBind.message);
    const sealed = await outcome(() => appToolHandlers.bindTool(ctx, { space_id: ROOM, tool: TOOL, bindings: { deals: 'agents' } }));
    check('a folder that holds what runs is refused', !sealed.ok && /holds what runs/.test(sealed.message), sealed.ok ? 'accepted' : sealed.message);
    const bound = await appToolHandlers.bindTool(ctx, {
      space_id: ROOM,
      tool: TOOL,
      bindings: { deal: ROOM_TYPE.toLowerCase(), deals: ROOM_FOLDER },
      settings: { currency: 'EUR' },
    });
    check(
      'bind_tool binds the room\'s own folder and type, spelled as the room spells them',
      bound.bindings.deal.bound === ROOM_TYPE && bound.bindings.deals.bound === ROOM_FOLDER && !bound.requirements.degraded && bound.bindings.deal.choices.includes(ROOM_TYPE),
      `${JSON.stringify({ deal: bound.bindings.deal.bound, deals: bound.bindings.deals.bound })} · degraded ${bound.requirements.degraded}`,
    );
    const roomInstall = (await listInstalls(ROOM)).find((row) => row.key === toolKey(HOUSE, TOOL));
    if (!roomInstall) throw new Error('no room install');

    // ── 4. the bridge, bound ──────────────────────────────────────────────────
    step('4. the bridge in the room, as its admin');
    const resolved = await resolveBridgeTarget(session, { kind: 'install', installId: roomInstall.id });
    if (!('principal' in resolved)) throw new Error(`resolveBridgeTarget refused: ${resolved.code} ${resolved.message}`);
    const target: ResolvedTarget = resolved;
    const call = (method: BridgeMethod, params: unknown) => handleBridgeCall(target, method, params);
    check(
      'the Tool is told what it is bound to and how it is set',
      'bindings' in target.install && target.install.bindings?.deal === ROOM_TYPE && target.install.settings?.currency === 'EUR' && target.install.sdk === 2,
      JSON.stringify(target.install),
    );
    const own = await call('records.query', { type: ROOM_TYPE, order: { key: 'amount', direction: 'desc' } });
    const ownRows = own.ok ? (own.value as { rows: Array<{ title: string }> }).rows : []
    check('records.query on the bound type answers with the room\'s records', own.ok && ownRows.map((r) => r.title).join(',') === 'Acme,Globex', describe(own));
    const theirs = await call('records.query', { type: HOUSE_TYPE });
    check('the house\'s type name is not reach here', !theirs.ok && theirs.error.code === 'perimeter', describe(theirs));
    const listed = await call('context.list', {});
    const paths = listed.ok ? (listed.value as Array<{ path: string }>).map((r) => r.path) : [];
    check('context.list sees the bound folder and nothing else', listed.ok && paths.length > 0 && paths.every((p) => p.startsWith(`${ROOM_FOLDER}/`)), paths.join(', '));
    const houseFolder = await call('context.read', { path: `${HOUSE_FOLDER}/northwind.md` });
    check('the house\'s folder is out of reach', !houseFolder.ok && houseFolder.error.code === 'perimeter', describe(houseFolder));
    // A listed Tool from outside the room asks before it first acts as someone;
    // the admin says yes, as they would in its first-use notice.
    const asked = await call('records.update', { path: `${ROOM_FOLDER}/acme.md`, fields: { stage: 'Won' } });
    check('it asks before it first edits as the admin', !asked.ok && asked.error.code === 'consent_required', describe(asked));
    await giveConsent(roomInstall.id, admin.id, actingReachOf(target.reach!, toolActionActs));
    const updated = await call('records.update', { path: `${ROOM_FOLDER}/acme.md`, fields: { stage: 'Won' } });
    const acme = await store.readNoteOrNull(shared(ROOM), `${ROOM_FOLDER}/acme.md`);
    check('records.update writes the declared field into the room\'s note', updated.ok && !!acme && /stage: Won/.test(acme), describe(updated));
    const amount = await call('records.update', { path: `${ROOM_FOLDER}/acme.md`, fields: { amount: 1 } });
    check('a field the Tool did not declare is refused', !amount.ok && amount.error.code === 'perimeter', describe(amount));
    const events = await call('actions.run', { name: 'list_events', input: {} });
    check('actions.run runs an allowlisted action in this space', events.ok, describe(events));
    const elsewhere = await call('actions.run', { name: 'list_events', input: { space_id: HOUSE } });
    check('actions.run naming another space is refused', !elsewhere.ok && elsewhere.error.code === 'forbidden', describe(elsewhere));
    const blob = await call('resources.list', {});
    check('a family it never declared is refused as perimeter', !blob.ok && blob.error.code === 'perimeter', describe(blob));

    const memberResolved = await resolveBridgeTarget({ userId: member.id, name: member.name ?? '', email: member.email ?? '' }, { kind: 'install', installId: roomInstall.id });
    if (!('principal' in memberResolved)) throw new Error(`member target refused: ${memberResolved.code}`);
    await call('state.set', { key: 'last', value: 'admin', scope: 'user' });
    await call('state.set', { key: 'layout', value: 'wide', scope: 'install' });
    const memberOwn = await handleBridgeCall(memberResolved, 'state.get', { key: 'last', scope: 'user' });
    const memberShared = await handleBridgeCall(memberResolved, 'state.get', { key: 'layout', scope: 'install' });
    check('state is the viewer\'s own by scope, and one value everyone shares by the other', memberOwn.ok && memberOwn.value === null && memberShared.ok && memberShared.value === 'wide', `${describe(memberOwn)} · ${describe(memberShared)}`);

    // ── 5. the frame, and the page ───────────────────────────────────────────
    step('5. kit 2 for this Tool, kit 1 for one written before it');
    const token = await mintFrameToken({ kind: 'install', installId: roomInstall.id, viewerId: admin.id, spaceId: ROOM });
    const frame = await fetch(`${TOOLS}/api/tools/runtime/frame?token=${encodeURIComponent(token)}`).then((r) => r.text());
    check('the frame maps the kit to kit 2 and links its stylesheet', /tool-kit\.js/.test(frame) && !/tool-kit-1\.js/.test(frame) && /tool-kit\.css/.test(frame) && /"date-fns"/.test(frame), 'import map + stylesheet');

    await appToolHandlers.createTool(ctx, { space_id: HOUSE, name: LEGACY, title: 'Deal Flow Legacy', description: 'Kit 1' });
    await appToolHandlers.writeTool(ctx, { space_id: HOUSE, name: LEGACY, file: 'index.md', content: fixture('legacy-index.md') });
    const legacyBuild = await appToolHandlers.writeTool(ctx, { space_id: HOUSE, name: LEGACY, file: 'ui.tsx', content: fixture('legacy-ui.tsx') });
    const legacyToken = await mintFrameToken({ kind: 'preview', name: LEGACY, viewerId: admin.id, spaceId: HOUSE });
    const legacyFrame = await fetch(`${TOOLS}/api/tools/runtime/frame?token=${encodeURIComponent(legacyToken)}`).then((r) => r.text());
    check('a Tool with no sdk keeps kit 1 and no compiled stylesheet', legacyBuild.build.ok && /tool-kit-1\.js/.test(legacyFrame) && !/tool-kit\.css/.test(legacyFrame), legacyBuild.build.errors.join(' | ') || 'kit 1');

    browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
    const { page } = await login(browser, admin.id);
    await page.goto(`${APP}/s/${HOUSE}/${ROOM}/t/${roomInstall.slug}`, { waitUntil: 'domcontentloaded' });
    const tool = page.frameLocator('iframe[title="Deal Flow"]');
    const summaryEl = tool.getByTestId('summary');
    await summaryEl.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => undefined);
    const summary = await summaryEl.textContent({ timeout: 5_000 }).catch(() => null);
    check('in the browser, the room\'s deals render in its currency', !!summary && /2 deals · EUR · 1970/.test(summary), summary ?? 'nothing rendered');
    const rows = await tool.getByRole('row').count().catch(() => 0);
    const acmeCell = await tool.getByText('€12,000').count().catch(() => 0);
    check('the table draws the rows through the module\'s formatting', rows === 3 && acmeCell === 1, `${rows} rows · €12,000 × ${acmeCell}`);
    const style = await tool
      .getByRole('button', { name: 'Remember' })
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, radius: cs.borderRadius, accent: getComputedStyle(document.documentElement).getPropertyValue('--vv-color-accent').trim() };
      })
      .catch(() => null);
    check('the button is the app\'s own: painted in the accent from the compiled stylesheet', !!style && style.bg !== 'rgba(0, 0, 0, 0)' && style.accent !== '' && style.radius !== '0px', JSON.stringify(style));
    await tool.getByRole('button', { name: 'Remember' }).click();
    const remembered = await tool.getByTestId('remembered').textContent({ timeout: 20_000 }).catch(() => null);
    check('state set through the kit comes back as the viewer\'s own', remembered === 'admin', remembered ?? 'no answer');

    // The console's installed list: each slot a picker holding what it is bound to.
    await page.goto(`${APP}/s/${HOUSE}/${ROOM}/admin?section=tools`, { waitUntil: 'domcontentloaded' });
    const dealPicker = page.locator('label').filter({ hasText: 'Deal type' }).locator('select').first();
    const pickerValue = await dealPicker.inputValue({ timeout: 60_000 }).catch(() => null);
    // The pickers open once the room's own choices have loaded.
    const enabled = await (async () => {
      for (let i = 0; i < 50; i++) {
        if (await dealPicker.isEnabled().catch(() => false)) return true;
        await sleep(200);
      }
      return false;
    })();
    const options = await dealPicker.locator('option').allTextContents().catch(() => [] as string[]);
    check('the picker offers the room\'s own types with the fields the slot needs', enabled && options.includes(ROOM_TYPE) && !options.includes(HOUSE_TYPE), options.join(', '));
    const folderValue = await page.locator('label').filter({ hasText: 'Deal notes' }).locator('select').first().inputValue({ timeout: 5_000 }).catch(() => null);
    await page.screenshot({ path: process.env.SHOT ?? join(tmpdir(), 'verify-tools-bindings.png'), fullPage: false }).catch(() => undefined);
    check('Console → Tools shows each slot bound, as a picker', pickerValue === ROOM_TYPE && folderValue === ROOM_FOLDER, `${pickerValue} · ${folderValue}`);

    // ── 6. shared down ────────────────────────────────────────────────────────
    step('6. shared into another room, bound to what it has');
    const note = await store.readNoteOrNull(shared(HOUSE), toolIndexPath(TOOL));
    if (!note) throw new Error('index note gone');
    await store.writeNote(shared(HOUSE), toolIndexPath(TOOL), note.replace('title: Deal Flow', `title: Deal Flow\nshare: [${SHARE_ROOM}]`), actor);
    let sharedInstall = null as Awaited<ReturnType<typeof listInstalls>>[number] | null;
    for (let i = 0; i < 20 && !sharedInstall; i++) {
      sharedInstall = (await listInstalls(SHARE_ROOM)).find((row) => row.key === toolKey(HOUSE, TOOL)) ?? null;
      if (!sharedInstall) await sleep(300);
    }
    check(
      'the shared install takes the house\'s folder and leaves the type it lacks unbound',
      !!sharedInstall && sharedInstall.sharedFrom?.id === HOUSE && sharedInstall.bindings.deals === HOUSE_FOLDER && !sharedInstall.bindings.deal && sharedInstall.degraded,
      JSON.stringify({ bindings: sharedInstall?.bindings, degraded: sharedInstall?.degraded, missing: sharedInstall?.requirements.bindings }),
    );
  } finally {
    await browser?.close();
    await cleanup(orders);
    const left = await Promise.all([
      prisma.appToolVersion.count({ where: { key: { in: [toolKey(HOUSE, TOOL), toolKey(HOUSE, LEGACY)] } } }),
      prisma.appToolInstall.count({ where: { key: { in: [toolKey(HOUSE, TOOL), toolKey(HOUSE, LEGACY)] } } }),
      prisma.contextRecord.count({ where: { type: { in: [HOUSE_TYPE, ROOM_TYPE] } } }),
    ]);
    check('cleanup leaves no versions, installs or records behind', left.every((n) => n === 0), left.join(' · '));
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  await prisma.$disconnect();
  if (failures > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
