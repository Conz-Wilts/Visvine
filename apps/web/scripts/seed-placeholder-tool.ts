/**
 * Seed the **Accounts Board** — the demo space's resident Tool.
 *
 * A local database with no Tool in it leaves four tables empty (app_tool_builds,
 * app_tool_versions, app_tool_installs, app_tool_state) and, more to the point,
 * leaves the whole authoring path unexercised. This walks one small Tool through
 * the public mechanism and nothing else:
 *
 *   appToolHandlers.createTool / writeTool ×3 → checkTool → publish →
 *   super-admin approve → install → seed its per-install state
 *
 * The sources live in `examples/tools/accounts-board/` as real files a member
 * could have written. Nothing here compiles them by hand or reaches past the
 * handlers.
 *
 * The Tool itself is deliberately dull: a read-only board over the organisation
 * notes under `communities/` that the seed layers already write, with a
 * `write: []` perimeter. It invents no node types and dispatches no agent, so it
 * adds no surface area to the seeded space beyond its own rail row.
 *
 * Idempotent. Every step checks first: an existing Tool is written over rather
 * than re-created, an unchanged working copy is not re-published, and an install
 * that is already current is left alone. Re-running it is how you pick up an
 * edit to the example sources.
 *
 *   pnpm --filter @visvine/web db:tool:seed [spaceId]
 *
 * Local only (guarded like every db:* script). It does NOT need `pnpm dev` —
 * everything is in-process.
 */
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import prisma from '../lib/prisma';
import { ADMIN_ALIAS_ID } from '../lib/types/context';
import { splitFrontmatter } from '../lib/notes/shared/markdown';
import { resolveContext } from '../lib/notes/resolve';
import { ActionError, type ActionCaller } from '../lib/actions/types';
import { appToolHandlers } from '../lib/actions/defs/apps';
import { applyUpgrade, listInstalls } from '../lib/tools/installs';
import { getVersion, reviewVersion, toolKey, versionHistory } from '../lib/tools/registry';
import { SPACE_ID } from './seed/space'

const SPACE = process.argv[2] ?? SPACE_ID;
const TOOL = 'accounts-board';
const REVIEW_NOTE = 'seed-placeholder-tool';

const SOURCES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'examples', 'tools', TOOL);
const source = (name: string): string => readFileSync(join(SOURCES, name), 'utf8');

let failures = 0;

function step(title: string) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}`);
}
function done(detail: string) {
  console.log(`  ok    ${detail}`);
}
function check(what: string, ok: boolean, detail: string) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`);
  console.log(`        ${detail}`);
}

async function main() {
  const space = await prisma.space.findUnique({ where: { id: SPACE }, select: { id: true } });
  if (!space) throw new Error(`Space ${SPACE} not found — run \`pnpm db:hq:full\` first.`);

  // Author as somebody who actually manages the space, so the handlers'
  // own authorization is doing the work rather than being bypassed.
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

  const session = { userId: owner.id, name: owner.name ?? '', email: owner.email ?? '' };
  // Not used directly — every write below goes through a handler, which resolves
  // its own principal. Asked here so a space this user cannot reach fails on the
  // first line rather than three steps in.
  const resolved = await resolveContext(session, SPACE);
  if (resolved instanceof Response) throw new Error(`resolveContext: ${resolved.status}`);
  const actor = { userId: owner.id, email: owner.email ?? '' };

  /** What the MCP transport hands the handlers after verifying a token. */
  const ctx: ActionCaller = {
    userId: owner.id,
    name: owner.name ?? '',
    email: owner.email ?? '',
    scopes: ['context:read', 'context:write', 'tools:author', 'tools:install'],
  };

  console.log(`space   ${SPACE}`);
  console.log(`owner   ${owner.email} (${owner.id})`);
  console.log(`sources ${SOURCES}`);

  // ── 1. author ──────────────────────────────────────────────────────────────
  step('1. create_tool + write_tool ×3');
  try {
    const created = await appToolHandlers.createTool(ctx, {
      space_id: SPACE,
      name: TOOL,
      title: 'Accounts Board',
      description: "Every organisation the space works with, grouped by segment.",
    });
    done(`scaffolded ${created.files.join(', ')}`);
  } catch (e) {
    if (!(e instanceof ActionError) || e.status !== 409) throw e;
    done(`tools/${TOOL}/ already exists — writing over it`);
  }

  // index.md last: it carries the config the other two are validated against.
  let build = null as Awaited<ReturnType<typeof appToolHandlers.writeTool>>['build'] | null;
  for (const [file, content] of [
    ['ui.tsx', source('ui.tsx')],
    ['data.js', source('data.js')],
    ['index.md', source('index.md')],
  ] as const) {
    const written = await appToolHandlers.writeTool(ctx, { space_id: SPACE, name: TOOL, file, content });
    build = written.build;
  }
  check(
    'the working copy compiles',
    build !== null && build.ok && build.errors.length === 0 && build.config_error === null,
    build
      ? `${build.size_bytes} bytes · ${build.errors.join(' | ') || build.config_error || 'no errors'}`
      : 'no build',
  );
  if (!build?.ok) throw new Error('the tool does not compile — nothing below would mean anything');

  const checked = await appToolHandlers.checkTool(ctx, { space_id: SPACE, name: TOOL });
  console.log(`  reach ${checked.perimeter.join(' · ')}`);
  console.log(`  where ${checked.surfaces.join(' · ')}`);
  if (checked.warnings.length > 0) console.log(`  warn  ${checked.warnings.join(' | ')}`);

  // ── 2. publish + approve ───────────────────────────────────────────────────
  step('2. publish + review');
  const key = toolKey(SPACE, TOOL);
  const newest = (await versionHistory(key))[0] ?? null;
  const newestDetail = newest ? await getVersion(newest.id) : null;
  // The WORKING COPY as the registry would snapshot it, not the files on disk:
  // the store owns a folder index's managed child block, so the stored
  // `index.md` is never byte-identical to the example file, and comparing
  // against the file would republish on every run.
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
      // One pending version per key: the pending row here IS this script's from
      // a previous run, so settle it and publish the new sources on top.
      const settled = await reviewVersion(newest.id, 'approved', actor, REVIEW_NOTE);
      done(`approved the stale pending v${settled.ok ? settled.version.version : '?'} first`);
    }
    const published = await appToolHandlers.publishTool(ctx, {
      space_id: SPACE,
      name: TOOL,
      note: REVIEW_NOTE,
    });
    versionId = published.version_id;
    done(`published v${published.version} (${published.status})`);
  }
  if (!versionId) throw new Error('nothing to review');

  const pending = (await versionHistory(key)).find((row) => row.status === 'pending');
  if (pending) {
    const reviewed = await reviewVersion(pending.id, 'approved', actor, REVIEW_NOTE);
    check(
      'a super admin approves the version',
      reviewed.ok && reviewed.version.status === 'approved',
      reviewed.ok
        ? `v${reviewed.version.version} approved, ${reviewed.upgraded} install(s) offered it`
        : reviewed.error,
    );
  } else {
    done('nothing pending review');
  }

  // ── 3. install ─────────────────────────────────────────────────────────────
  step('3. install');
  let install = (await listInstalls(SPACE)).find((row) => row.key === key) ?? null;
  if (!install) {
    // By id, not key: a key lookup hands out only marketplace-listed versions,
    // and this one is the space's own, approved here and listed nowhere.
    const installed = await appToolHandlers.installTool(ctx, { space_id: SPACE, version_id: versionId });
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

  // ── 4. per-install state ───────────────────────────────────────────────────
  //
  // A Tool's iframe is sandboxed without allow-same-origin, so it has no
  // localStorage — app_tool_state IS its persistence. Seeded directly rather
  // than through the bridge: this Tool never calls `visvine.state.set` itself,
  // and inventing a write it does not make would be the wrong kind of fixture.
  step('4. per-install state');
  const state = [
    { key: 'board:collapsedSegments', value: { segments: ['Unsorted'] } },
    { key: 'ui:lastOpenedAt', value: { at: '2026-08-23T03:30:00.000Z' } },
  ];
  for (const row of state) {
    await prisma.appToolState.upsert({
      where: { app_tool_state_identity: { installId: install.id, key: row.key } },
      create: { installId: install.id, key: row.key, value: row.value as never },
      update: {},
    });
  }
  done(`${state.length} key(s) on install ${install.slug}`);

  step('done');
  console.log(`  Open the Accounts rail item in ${SPACE}.`);
  console.log(`  ${failures} check(s) failed`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
