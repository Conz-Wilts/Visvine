/**
 * The live end-to-end run for user-created Tools — the counterpart to the pure
 * suites (tests/tools-*.test.ts), which can drive every part of this except the
 * whole of it. One fixture Tool goes the entire distance:
 *
 *   author over the MCP handlers → publish → super-admin review → install →
 *   render its frame over real HTTP → drive its bridge → publish a wider v2 →
 *   approve → upgrade → uninstall
 *
 * Everything is called the way the app calls it: `appToolHandlers.*` with a
 * synthetic ActionCaller for the space owner (the transport is the only thing
 * skipped — `withCtx` adds scope checking and JSON framing, nothing else), the
 * registry and install services directly, `handleBridgeCall` against a
 * `resolveBridgeTarget` result, and plain `fetch` for the three runtime routes
 * that only exist over the wire. The refusals in the middle are asserted too:
 * a member cannot publish, and the Tool cannot read outside its perimeter.
 *
 * The fixture lives in scripts/fixtures/tools/hello/ so the sources are real
 * files an author could have written rather than string literals in a test.
 *
 * Needs `pnpm dev` running for step 8's HTTP checks; everything else is
 * in-process. It WRITES to the database (notes, a directory node, registry
 * rows, an install, the space's featureConfig), so it is guarded to a local one
 * and takes all of it back out at the end — the cleanup also runs first, which
 * is what makes a re-run after a failed one start from the same place.
 *
 *   pnpm --filter @visvine/web exec tsx scripts/verify-tools-e2e.ts [spaceId]
 *   pnpm --filter @visvine/web verify:tools
 *
 * If the local `.env` still carries a `CLOUD_SQL_CONNECTION_NAME` from a
 * `pnpm dev:cloud` session, the local-DB guard refuses on sight even though
 * DATABASE_URL points at Docker. Clear it for the run: `CLOUD_SQL_CONNECTION_NAME= pnpm …`.
 *
 * Env:
 *   BASE_URL      the app origin, default http://localhost:3000
 *   TOOLS_ORIGIN  where the Tool frame is served, default http://127.0.0.1:3000
 *                 (a different ORIGIN from the app on the same dev server, so
 *                 cookies scoped to one are never sent to the other)
 */
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import prisma from '../lib/prisma';
import { ADMIN_ALIAS_ID } from '../lib/types/context';
import type { SpaceFeatureConfig } from '../lib/types/space';
import { toolRailKey } from '../lib/featureAccess';
import { writeGated } from '../lib/notes/contextService';
import { principalOf, resolveContext } from '../lib/notes/resolve';
import * as store from '../lib/notes/store';
import { readSpaceConfig, updateSpaceConfig } from '../lib/spaces/spaceConfig';
import { ActionError, type ActionCaller } from '../lib/actions/types';
import { appToolHandlers } from '../lib/actions/defs/apps';
import { handleBridgeCall } from '../lib/tools/bridge';
import { toolFolderPath, toolIndexPath } from '../lib/tools/config';
import { mintFrameToken } from '../lib/tools/frameToken';
import { applyUpgrade, installedToolsForSpaces, listInstalls, uninstall } from '../lib/tools/installs';
import type { BridgeMethod, BridgeResponse } from '../lib/tools/protocol';
import { reviewVersion, toolKey } from '../lib/tools/registry';
import { resolveBridgeTarget, type ResolvedTarget } from '../lib/tools/target';

const SPACE = process.argv[2] ?? 'community:blackbird-ventures';
const TOOL = 'hello';
const RAIL_KEY = toolRailKey(TOOL);

/** Everything the fixture Tool declares, and the only notes it may touch. */
const DEMO_GLOB = 'demo/**';
const DEMO_NOTES = ['demo/alpha.md', 'demo/beta.md'];
const TOOL_OUTPUT = 'demo/from-tool.md';
/** Inside v2's read perimeter but NOT v1's — the refusal this run proves. */
const OUTSIDE_PERIMETER = 'people/index.md';
/** Compiled into the bundle, so the runtime route can be shown serving OUR code. */
const MARKER = 'verify-tools-e2e:hello';

/**
 * Every note this script may create, and therefore every one it may remove.
 * The Tool's index note is LAST on purpose: the store's build hook rebuilds a
 * Tool when a source note is deleted and only drops the build when the INDEX
 * goes (lib/tools/hooks.ts#toolNoteDeleted), so removing the index first would
 * leave the next deletion re-creating the row.
 */
const OWN_NOTES = [
  ...DEMO_NOTES,
  TOOL_OUTPUT,
  'demo/index.md',
  `${toolFolderPath(TOOL)}/ui.md`,
  `${toolFolderPath(TOOL)}/data.md`,
  toolIndexPath(TOOL),
];

const APP = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const TOOLS = (process.env.TOOLS_ORIGIN || 'http://127.0.0.1:3000').replace(/\/$/, '');

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tools', TOOL);
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail: string): boolean {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n        ${detail.slice(0, 400)}`);
  if (ok) pass++;
  else fail++;
  return ok;
}

function step(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(1, 58 - title.length))}`);
}

/** A refusal we expect: its status and message, or a description of whatever
 *  came back instead of one. */
async function refusal(
  run: () => Promise<unknown>,
): Promise<{ status: number; message: string } | string> {
  try {
    return `no refusal — returned ${JSON.stringify(await run()).slice(0, 120)}`;
  } catch (e) {
    if (e instanceof ActionError) return { status: e.status, message: e.message };
    return `threw ${e instanceof Error ? e.constructor.name : typeof e}: ${String(e)}`;
  }
}

function sharedContext(spaceId: string): store.Context {
  return { spaceId, ownerKey: store.SHARED_OWNER_KEY };
}

// ── cleanup ───────────────────────────────────────────────────────────────────

/**
 * Take the fixture back out, in the order the foreign keys allow: the install
 * (its state rows cascade), the registry rows, the build, the notes, the two
 * folder rows and the directory node. Every step is a deleteMany or is guarded,
 * so this is safe to run BEFORE the test as well as after it.
 *
 * It only ever names paths from OWN_NOTES — never a folder wholesale — and it
 * edits `featureConfig` key by key rather than restoring a snapshot, because
 * the space it runs against is somebody's real dev data that another session
 * may be changing at the same time.
 *
 * `dropOrder` is for the one thing uninstalling cannot undo: installing
 * MATERIALISES an absent `featureConfig.order` (installs.ts#orderWithRail), and
 * removing the rail key afterwards leaves the space pinned to an order it never
 * chose. Passed true when the column had no order before this run.
 */
async function cleanup(spaceId: string, dropOrder: boolean): Promise<void> {
  const context = sharedContext(spaceId);
  const key = toolKey(spaceId, TOOL);

  await prisma.appToolInstall.deleteMany({ where: { key } });
  await prisma.appToolVersion.deleteMany({ where: { key } });

  for (const path of OWN_NOTES) await store.deleteNote(context, path);
  // After the notes, never before: every one of those deletions runs the
  // compile hook, which would put a fresh build row back.
  await prisma.appToolBuild.deleteMany({ where: { spaceId, name: TOOL } });
  // deleteNote trashes rather than deletes, and the trash is a surface members
  // look at — so purge exactly the rows this run put there.
  await prisma.contextNote.deleteMany({
    where: {
      spaceId,
      ownerKey: store.SHARED_OWNER_KEY,
      deletedAt: { not: null },
      deletedPath: { in: OWN_NOTES },
    },
  });
  // Folder rows outlive their notes on purpose (an empty folder is a real
  // thing), so drop the two this script created — but only once nothing else
  // lives under them.
  for (const folder of [toolFolderPath(TOOL), 'demo']) {
    const remaining = await prisma.contextNote.count({
      where: {
        spaceId,
        ownerKey: store.SHARED_OWNER_KEY,
        deletedAt: null,
        path: { startsWith: `${folder}/` },
      },
    });
    if (remaining === 0) {
      await prisma.contextFolder.deleteMany({
        where: { spaceId, ownerKey: store.SHARED_OWNER_KEY, path: folder },
      });
    }
  }

  await prisma.node.deleteMany({ where: { id: `tool:${TOOL}` } });

  await updateSpaceConfig(spaceId, (stored) => {
    const current = stored.featureConfig ?? {};
    const without = (list: string[] | undefined) => list?.filter((entry) => entry !== RAIL_KEY);
    // `enabled` is the one uninstall leaves behind — featureConfigWithoutRail
    // deliberately keeps it, so a re-install doesn't inherit an old "off".
    const enabled = current.enabled
      ? Object.fromEntries(Object.entries(current.enabled).filter(([key]) => key !== RAIL_KEY))
      : undefined;
    const next: SpaceFeatureConfig = {
      ...current,
      ...(current.order ? { order: without(current.order) } : {}),
      ...(current.more ? { more: without(current.more) } : {}),
      ...(current.adminOnly ? { adminOnly: without(current.adminOnly) } : {}),
      ...(enabled ? { enabled } : {}),
    };
    if (dropOrder) delete next.order;
    return { featureConfig: next };
  });
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

interface Fetched {
  status: number;
  headers: Headers;
  body: string;
}

async function get(url: string): Promise<Fetched> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

async function serverIsUp(): Promise<boolean> {
  try {
    await fetch(`${APP}/`, { signal: AbortSignal.timeout(5_000) });
    return true;
  } catch {
    return false;
  }
}

// ── the run ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // The space owner: the principal every other verify script resolves, and the
  // one an authoring agent would be connected as.
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

  const session = {
    userId: owner.id,
    name: owner.name ?? '',
    email: owner.email ?? '',
  };
  const resolved = await resolveContext(session, SPACE);
  if (resolved instanceof Response) throw new Error(`resolveContext: ${resolved.status}`);
  const principal = await principalOf(resolved);
  const context = sharedContext(SPACE);
  const actor = { userId: owner.id, email: owner.email ?? '' };

  // What the MCP transport hands the handlers after verifying a token. The
  // scopes are the real ones for this tool set; the handlers never read them
  // (`withCtx` does), so they are here to keep the object honest.
  const ctx: ActionCaller = {
    userId: owner.id,
    name: owner.name ?? '',
    email: owner.email ?? '',
    scopes: ['context:read', 'context:write', 'tools:author', 'tools:install'],
  };

  console.log(`space   ${SPACE}`);
  console.log(`owner   ${owner.email} (${owner.id})`);
  console.log(`app     ${APP}`);
  console.log(`tools   ${TOOLS}`);

  const orderWasAbsent = (await readSpaceConfig(SPACE))?.featureConfig.order === undefined;
  await cleanup(SPACE, orderWasAbsent); // leftovers from a run that died half way

  try {
    // Notes for the Tool to find, written by the owner as any member would.
    for (const [i, path] of DEMO_NOTES.entries()) {
      const body = `---\ntitle: Demo ${i + 1}\ntype: note\n---\n\nA note for the ${TOOL} tool to read.\n`;
      const written = await writeGated(principal, context, path, body);
      if (written.status === 'denied') throw new Error(`could not seed ${path}: ${written.reason}`);
    }

    // ── 1. create ────────────────────────────────────────────────────────────
    step('1. create_tool');
    const created = await appToolHandlers.createTool(ctx, {
      space_id: SPACE,
      name: TOOL,
      title: 'Hello',
      description: 'Lists the demo notes in this space and writes one back.',
    });
    const indexNote = await store.readNoteOrNull(context, toolIndexPath(TOOL));
    const node = await prisma.node.findUnique({
      where: { id: `tool:${TOOL}` },
      select: { type: true },
    });
    check(
      'create_tool scaffolds the folder, its three files and the directory node',
      indexNote !== null && node?.type === 'tool' && created.files.length === 3,
      `${created.files.join(', ')} · node tool:${TOOL} type=${node?.type ?? 'missing'}`,
    );

    // ── 2. a write that does not compile ─────────────────────────────────────
    step('2. write_tool with a syntax error');
    const broken = await appToolHandlers.writeTool(ctx, {
      space_id: SPACE,
      name: TOOL,
      file: 'ui.tsx',
      content: fixture('ui.broken.tsx'),
    });
    const located = broken.build.errors.find((line) => /^ui\.tsx:\d+:\d+ /.test(line));
    check(
      'the write lands and answers with a located diagnostic',
      broken.build.ok === false && located !== undefined && 'fix' in broken,
      located || broken.build.errors.join(' | ') || 'no errors at all',
    );

    // ── 3. the real sources ──────────────────────────────────────────────────
    step('3. write_tool the working sources');
    let build = broken.build;
    for (const file of ['ui.tsx', 'data.js', 'index.md'] as const) {
      const written = await appToolHandlers.writeTool(ctx, {
        space_id: SPACE,
        name: TOOL,
        file,
        content: fixture(file),
      });
      build = written.build;
    }
    check(
      'ui.tsx + data.js + index.md compile',
      build.ok && build.errors.length === 0 && build.config_error === null,
      `${build.size_bytes} bytes compiled · ${build.errors.join(' | ') || 'no errors'}`,
    );

    // ── 4. check_tool ────────────────────────────────────────────────────────
    step('4. check_tool');
    const checked = await appToolHandlers.checkTool(ctx, { space_id: SPACE, name: TOOL });
    check(
      'check_tool: compiles, nothing missing, nothing to warn about',
      checked.build.ok &&
        checked.requirements.missing.length === 0 &&
        checked.requirements.degraded_here === false &&
        checked.warnings.length === 0 &&
        checked.ready_to_publish,
      `${checked.perimeter.join(' · ')} · ${checked.surfaces.join(' · ')}`,
    );

    // ── 5. publish ───────────────────────────────────────────────────────────
    step('5. publish_tool');
    const v1 = await appToolHandlers.publishTool(ctx, {
      space_id: SPACE,
      name: TOOL,
      note: 'verify-tools-e2e first submission',
    });
    check(
      'publish_tool queues version 1 for review',
      v1.status === 'pending' && v1.version === 1 && v1.key === toolKey(SPACE, TOOL),
      `${v1.key} v${v1.version} ${v1.status} (${v1.version_id})`,
    );

    const member = await prisma.user.findFirst({
      where: { email: 'member@local.dev' },
      select: { id: true, name: true, email: true },
    });
    if (!member) throw new Error('member@local.dev is not seeded — the publish refusal cannot be checked');
    const memberCtx: ActionCaller = {
      userId: member.id,
      name: member.name ?? '',
      email: member.email ?? '',
      scopes: ['tools:author'],
    };
    const refused = await refusal(() =>
      appToolHandlers.publishTool(memberCtx, { space_id: SPACE, name: TOOL }),
    );
    check(
      'a member of the space cannot publish',
      typeof refused !== 'string' && refused.status === 403 && /admin/i.test(refused.message),
      typeof refused === 'string' ? refused : `${refused.status} ${refused.message}`,
    );

    // ── 6. review ────────────────────────────────────────────────────────────
    step('6. reviewVersion as a Visvine super admin');
    const reviewed = await reviewVersion(v1.version_id, 'approved', actor, 'verify-tools-e2e');
    check(
      'the super admin approves version 1',
      reviewed.ok && reviewed.version.status === 'approved',
      reviewed.ok
        ? `v${reviewed.version.version} approved, ${reviewed.upgraded} install(s) offered it`
        : reviewed.error,
    );

    // ── 7. install ───────────────────────────────────────────────────────────
    step('7. install_tool');
    // The MCP door; `installVersion` is what runs underneath it, once the key
    // has been resolved to its newest approved version.
    const installed = await appToolHandlers.installTool(ctx, {
      space_id: SPACE,
      key: toolKey(SPACE, TOOL),
    });
    const install = (await listInstalls(SPACE)).find((row) => row.key === toolKey(SPACE, TOOL));
    const order = (await readSpaceConfig(SPACE))?.featureConfig.order ?? [];
    const clientTools = (await installedToolsForSpaces([SPACE])).get(SPACE) ?? [];
    check(
      'the install exists, takes a rail key and reaches the space DTO',
      install !== undefined &&
        install.slug === TOOL &&
        install.version === 1 &&
        order.includes(RAIL_KEY) &&
        clientTools.some((tool) => tool.slug === TOOL && tool.href === `/t/${TOOL}`),
      `${installed.slug} v${installed.version} · order [${order.join(', ')}] · DTO [${clientTools
        .map((tool) => tool.slug)
        .join(', ')}]`,
    );
    if (!install) throw new Error('no install to carry on with');

    // ── 8. the runtime, over the wire ────────────────────────────────────────
    step('8. frame document, bundle and vendor ESM');
    const up = await serverIsUp();
    if (!check('the dev server answers', up, up ? APP : `${APP} is not answering — start \`pnpm dev\``)) {
      console.log('        skipping the three HTTP checks below');
    } else {
      const token = await mintFrameToken({
        kind: 'install',
        installId: install.id,
        viewerId: owner.id,
        spaceId: SPACE,
      });
      const frame = await get(`${TOOLS}/api/tools/runtime/frame?token=${encodeURIComponent(token)}`);
      const csp = frame.headers.get('content-security-policy') ?? '';
      // The bundle id is derived from the token server-side, so read the URL the
      // document actually points at rather than composing one that agrees.
      const bundleUrl = /"(https?:\/\/[^"]+\/api\/tools\/runtime\/bundle\/[^"]+)"/.exec(frame.body);
      check(
        'GET the frame document → 200, sandbox CSP, import map',
        frame.status === 200 &&
          csp.includes("connect-src 'none'") &&
          csp.includes('frame-ancestors') &&
          frame.body.includes('type="importmap"') &&
          frame.body.includes('"@visvine/tool-kit"') &&
          bundleUrl !== null,
        `${frame.status} · ${csp
          .split('; ')
          .filter((directive) => /^(connect-src|frame-ancestors|script-src)/.test(directive))
          .join('; ')}`,
      );

      if (bundleUrl) {
        const js = await get(bundleUrl[1]);
        check(
          "GET the bundle → this Tool's own compiled component",
          js.status === 200 &&
            (js.headers.get('content-type') ?? '').includes('javascript') &&
            js.body.includes(MARKER) &&
            js.body.includes('@visvine/tool-kit') &&
            /export\s*\{[^}]*\bdefault\b/.test(js.body),
          `${js.status} · ${js.body.length} bytes · marker ${js.body.includes(MARKER) ? 'present' : 'MISSING'}`,
        );
      } else {
        check('GET the bundle', false, 'the frame document named no bundle URL');
      }

      const vendor = await get(`${TOOLS}/api/tools/runtime/vendor/react.js`);
      check(
        'GET the vendor React module → 200 of real ESM',
        vendor.status === 200 && vendor.body.includes('useState'),
        `${vendor.status} · ${vendor.body.length} bytes · ${vendor.headers.get('content-type') ?? 'no content-type'}`,
      );
    }

    // ── 9. the bridge ────────────────────────────────────────────────────────
    step("9. the bridge, under the viewer's own principal");
    const targetOrError = await resolveBridgeTarget(session, { kind: 'install', installId: install.id });
    if (!('principal' in targetOrError)) {
      throw new Error(`resolveBridgeTarget refused: ${targetOrError.code} ${targetOrError.message}`);
    }
    const target: ResolvedTarget = targetOrError;
    const call = (method: BridgeMethod, params: unknown): Promise<BridgeResponse> =>
      handleBridgeCall(target, method, params);

    const listed = await call('context.list', { glob: DEMO_GLOB });
    const rows = (listed.ok ? listed.value : []) as Array<{ path: string }>;
    check(
      'context.list returns the demo notes',
      listed.ok && DEMO_NOTES.every((path) => rows.some((row) => row.path === path)),
      listed.ok ? rows.map((row) => row.path).join(', ') : `${listed.error.code}: ${listed.error.message}`,
    );

    const outside = await call('context.read', { path: OUTSIDE_PERIMETER });
    check(
      'a read outside the declared perimeter is refused as `perimeter`',
      !outside.ok && outside.error.code === 'perimeter',
      outside.ok
        ? `${OUTSIDE_PERIMETER} came back as a note instead`
        : `${outside.error.code}: ${outside.error.message}`,
    );

    const wrote = await call('context.write', {
      path: TOOL_OUTPUT,
      content: `---\ntitle: From the tool\nmarker: ${MARKER}\n---\n\nWritten through the bridge.\n`,
    });
    const savedNote = await prisma.contextNote.findFirst({
      where: { spaceId: SPACE, ownerKey: store.SHARED_OWNER_KEY, path: TOOL_OUTPUT, deletedAt: null },
      select: { id: true },
    });
    const revision = savedNote
      ? await prisma.contextNoteRevision.findFirst({
          where: { noteId: savedNote.id },
          orderBy: { at: 'desc' },
          select: { editor: true, editorEmail: true, origin: true },
        })
      : null;
    check(
      'context.write lands the note with the VIEWER recorded as its editor',
      wrote.ok && savedNote !== null && revision?.editorEmail === owner.email && revision?.origin === 'edit',
      wrote.ok
        ? `${TOOL_OUTPUT} · editor ${revision?.editor ?? '?'} <${revision?.editorEmail ?? '?'}> origin ${revision?.origin ?? '?'}`
        : `${wrote.error.code}: ${wrote.error.message}`,
    );

    const summarised = await call('data.call', { fn: 'summarise', args: { glob: DEMO_GLOB } });
    const counts = (summarised.ok ? summarised.value : null) as {
      notes?: number;
      bytes?: number;
      byType?: Record<string, number>;
    } | null;
    check(
      'data.call runs the data.js handler in the isolate and counts the notes',
      summarised.ok && (counts?.notes ?? 0) >= DEMO_NOTES.length + 1 && (counts?.bytes ?? 0) > 0,
      summarised.ok
        ? `${counts?.notes} notes, ${counts?.bytes} bytes, types ${JSON.stringify(counts?.byType)}`
        : `${summarised.error.code}: ${summarised.error.message}`,
    );

    const stateValue = { column: 'title', at: MARKER };
    const set = await call('state.set', { key: 'view', value: stateValue });
    const got = await call('state.get', { key: 'view' });
    check(
      'state.set / state.get round-trips per install',
      // Deep equality, not a JSON string compare: an install's state goes
      // through a jsonb column, which does not preserve key order.
      set.ok && got.ok && isDeepStrictEqual(got.value, stateValue),
      got.ok ? JSON.stringify(got.value) : `set ok=${set.ok}, get failed`,
    );

    // ── 10. a wider v2, approved and applied ─────────────────────────────────
    step('10. publish v2 with a wider perimeter, approve, upgrade');
    await appToolHandlers.writeTool(ctx, {
      space_id: SPACE,
      name: TOOL,
      file: 'index.md',
      content: fixture('index.v2.md'),
    });
    const v2 = await appToolHandlers.publishTool(ctx, {
      space_id: SPACE,
      name: TOOL,
      note: 'wider read reach',
    });
    const approved = await reviewVersion(v2.version_id, 'approved', actor);
    const offered = (await listInstalls(SPACE)).find((row) => row.id === install.id);
    check(
      'approving v2 offers it to the install, with the perimeter diff attached',
      approved.ok &&
        approved.upgraded === 1 &&
        offered?.pendingVersion?.id === v2.version_id &&
        (offered?.pendingVersion?.perimeterDiff.read.added.length ?? 0) > 0,
      `v${v2.version} ${approved.ok ? approved.version.status : 'FAILED'} · read += ${JSON.stringify(
        offered?.pendingVersion?.perimeterDiff.read.added ?? [],
      )}`,
    );

    const upgraded = await applyUpgrade(SPACE, install.id, actor);
    check(
      'applyUpgrade pins the install to v2 and clears the offer',
      upgraded.ok && upgraded.install.version === 2 && upgraded.install.pendingVersion === null,
      upgraded.ok ? `now on v${upgraded.install.version}` : upgraded.error,
    );

    // ── 11. uninstall ────────────────────────────────────────────────────────
    step('11. uninstall');
    const removed = await uninstall(SPACE, install.id, actor);
    const afterOrder = (await readSpaceConfig(SPACE))?.featureConfig.order ?? [];
    const afterInstalls = await listInstalls(SPACE);
    check(
      'uninstalling drops the row and takes its rail key with it',
      removed.ok &&
        !afterOrder.includes(RAIL_KEY) &&
        !afterInstalls.some((row) => row.key === toolKey(SPACE, TOOL)),
      `order [${afterOrder.join(', ')}]`,
    );
  } finally {
    step('cleanup');
    await cleanup(SPACE, orderWasAbsent);
    const railKeyLeft = ((await readSpaceConfig(SPACE))?.featureConfig.enabled ?? {})[RAIL_KEY];
    const leftover = await prisma.contextNote.count({
      where: {
        spaceId: SPACE,
        ownerKey: store.SHARED_OWNER_KEY,
        deletedAt: null,
        OR: [{ path: { startsWith: 'demo/' } }, { path: { startsWith: `${toolFolderPath(TOOL)}/` } }],
      },
    });
    const rows =
      (await prisma.appToolVersion.count({ where: { key: toolKey(SPACE, TOOL) } })) +
      (await prisma.appToolBuild.count({ where: { spaceId: SPACE, name: TOOL } })) +
      (await prisma.appToolInstall.count({ where: { key: toolKey(SPACE, TOOL) } }));
    check(
      'cleanup leaves no fixture notes, registry rows or rail key behind',
      leftover === 0 && rows === 0 && railKeyLeft === undefined,
      `${leftover} note(s), ${rows} registry/build/install row(s), ${RAIL_KEY} ${
        railKeyLeft === undefined ? 'gone' : `still ${railKeyLeft}`
      }`,
    );

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exitCode = 1;
  }
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
