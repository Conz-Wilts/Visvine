/**
 * The desktop shell's half of the Tool sandbox, live: the hostile fixture Tool
 * in the real Electron shell, navigating its own frame on the suite's word.
 * A browser can only take the frame down after the request has left; the shell
 * refuses the navigation outright (apps/desktop/src/urls.ts#toolFrameNavigationRefused)
 * and tells the page, which draws the refusal and records the incident.
 *
 * Needs `pnpm dev` running and the desktop built
 * (`pnpm --filter @visvine/desktop build`). Writes to the LOCAL database and
 * takes it all back out, like verify-tools-escape.
 *
 * Run: pnpm --filter @visvine/web verify:tools:desktop [spaceId]
 */
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import prisma from '../lib/prisma';
import { ADMIN_ALIAS_ID } from '../lib/types/context';
import * as store from '../lib/notes/store';
import type { ActionCaller } from '../lib/actions/types';
import { appToolHandlers } from '../lib/actions/defs/apps';
import { toolFolderPath, toolIndexPath } from '../lib/tools/config';
import { listInstalls, uninstall } from '../lib/tools/installs';
import { toolKey } from '../lib/tools/registry';
import { readSpaceConfig, updateSpaceConfig } from '../lib/spaces/spaceConfig';
import { toolRailKey } from '../lib/featureAccess';
import type { SpaceFeatureConfig } from '../lib/types/space';
import { SPACE_ID } from './seed/space';

const SPACE = process.argv[2] ?? SPACE_ID;
const TOOL = 'hostile';
const RAIL_KEY = toolRailKey(TOOL);
const APP = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(HERE, '..', '..', 'desktop');
const FIXTURES = join(HERE, 'fixtures', 'tools', TOOL);
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const OWN_NOTES = [
  'hostile/owned.md',
  'hostile/leave.md',
  'hostile/index.md',
  `${toolFolderPath(TOOL)}/ui.md`,
  `${toolFolderPath(TOOL)}/data.md`,
  toolIndexPath(TOOL),
];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n        ${detail.slice(0, 400)}`);
  if (ok) pass++;
  else fail++;
}

async function cleanup(dropOrder: boolean): Promise<void> {
  const context = { spaceId: SPACE, ownerKey: store.SHARED_OWNER_KEY };
  const key = toolKey(SPACE, TOOL);
  await prisma.appToolInstall.deleteMany({ where: { key } });
  await prisma.appToolVersion.deleteMany({ where: { key } });
  await prisma.appToolIncident.deleteMany({ where: { key } });
  for (const path of OWN_NOTES) await store.deleteNote(context, path);
  await prisma.appToolBuild.deleteMany({ where: { spaceId: SPACE, name: TOOL } });
  await prisma.contextNote.deleteMany({
    where: { spaceId: SPACE, ownerKey: store.SHARED_OWNER_KEY, deletedAt: { not: null }, deletedPath: { in: OWN_NOTES } },
  });
  for (const folder of [toolFolderPath(TOOL), 'hostile']) {
    const remaining = await prisma.contextNote.count({
      where: { spaceId: SPACE, ownerKey: store.SHARED_OWNER_KEY, deletedAt: null, path: { startsWith: `${folder}/` } },
    });
    if (remaining === 0) {
      await prisma.contextFolder.deleteMany({ where: { spaceId: SPACE, ownerKey: store.SHARED_OWNER_KEY, path: folder } });
    }
  }
  await prisma.node.deleteMany({ where: { id: `tool:${TOOL}` } });
  await updateSpaceConfig(SPACE, (stored) => {
    const current = stored.featureConfig ?? {};
    const without = (list: string[] | undefined) => list?.filter((entry) => entry !== RAIL_KEY);
    const enabled = current.enabled
      ? Object.fromEntries(Object.entries(current.enabled).filter(([entry]) => entry !== RAIL_KEY))
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

async function main(): Promise<void> {
  const holder = await prisma.userAlias.findFirst({ where: { spaceId: SPACE, aliasId: ADMIN_ALIAS_ID }, select: { userId: true } });
  if (!holder) throw new Error(`nobody manages ${SPACE}`);
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: holder.userId }, select: { id: true, name: true, email: true } });
  const ctx: ActionCaller = {
    userId: owner.id,
    name: owner.name ?? '',
    email: owner.email ?? '',
    scopes: ['context:read', 'context:write', 'tools:author', 'tools:install'],
  };
  const orderWasAbsent = (await readSpaceConfig(SPACE))?.featureConfig.order === undefined;
  await cleanup(orderWasAbsent);

  const app = { current: null as null | Awaited<ReturnType<typeof electron.launch>> };
  try {
    await appToolHandlers.createTool(ctx, { space_id: SPACE, name: TOOL, title: 'Hostile', description: 'A hostile fixture Tool.' });
    for (const file of ['ui.tsx', 'data.js', 'index.md'] as const) {
      await appToolHandlers.writeTool(ctx, { space_id: SPACE, name: TOOL, file, content: fixture(file) });
    }
    const version = await appToolHandlers.publishTool(ctx, { space_id: SPACE, name: TOOL });
    await appToolHandlers.installTool(ctx, { space_id: SPACE, version_id: version.version_id });
    const install = (await listInstalls(SPACE)).find((row) => row.key === toolKey(SPACE, TOOL));
    if (!install) throw new Error('no install');

    app.current = await electron.launch({
      cwd: DESKTOP,
      args: ['.'],
      env: {
        ...process.env,
        VISVINE_DESKTOP_DEV: '1',
        VISVINE_DESKTOP_URL: APP,
        VISVINE_DESKTOP_USER_DATA: mkdtempSync(join(tmpdir(), 'visvine-desktop-tools-')),
      } as Record<string, string>,
      timeout: 60_000,
    });
    const page = await app.current.firstWindow({ timeout: 60_000 });
    const left: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('left=')) left.push(request.url());
    });

    await page.goto(`${APP}/dev/login?callbackUrl=%2Fhome`, { waitUntil: 'domcontentloaded' });
    const button = page.locator(`form[action^="/api/dev/login-as/${owner.id}"] button`);
    await button.first().waitFor({ timeout: 30_000 });
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/dev') && !url.pathname.startsWith('/api'), { timeout: 60_000 }),
      button.first().click(),
    ]);
    await page.goto(`${APP}/s/${encodeURIComponent(SPACE)}/t/${TOOL}`, { waitUntil: 'domcontentloaded' });
    const frame = page.locator('iframe[title="Hostile"]');
    await frame.waitFor({ state: 'attached', timeout: 60_000 });
    check('the Tool renders in the desktop shell', true, (await frame.getAttribute('src'))?.slice(0, 80) ?? '');
    // Let the Tool run its probes and start listening for the word.
    await sleep(8_000);

    const since = new Date();
    await store.writeNote({ spaceId: SPACE, ownerKey: store.SHARED_OWNER_KEY }, 'hostile/leave.md', '# leave\n', {
      id: owner.id,
      name: owner.name ?? '',
      email: owner.email,
    });
    const stopped = await page
      .getByText('This tool tried to leave its frame and was stopped.')
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    check('the shell refuses the navigation and the page draws the refusal', stopped, stopped ? 'refusal drawn' : 'no refusal drawn');
    await sleep(1_000);
    check('the navigation never left the machine', left.length === 0, left.length ? `REQUESTED ${left[0]}` : 'no request for the leaked URL');
    const incident = await prisma.appToolIncident.findFirst({
      where: { kind: 'navigation', installId: install.id, createdAt: { gte: since } },
      select: { severity: true },
    });
    check('and it is recorded as a severe incident', incident?.severity === 'severe', incident ? incident.severity : 'no incident');
    await uninstall(SPACE, install.id, { userId: owner.id, email: owner.email ?? '' });
  } catch (e) {
    fail++;
    console.error(`FAIL  ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  } finally {
    await app.current?.close().catch(() => {});
    await cleanup(orderWasAbsent);
    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exitCode = 1;
  }
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
