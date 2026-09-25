/**
 * A Tool inside the app's shell, live — the half of M2 only a browser can show.
 *
 *   a member authors the fixture at scripts/fixtures/tools/sections/ and
 *   publishes it from its Tool tab → an admin approves it on Approvals, where
 *   the install sheet opens, and installs it into More → the admin opens
 *   `/t/sections` and switches its three sections on the band, and the Tool
 *   asks for one itself → a band button reaches it → ⋯ About and Report →
 *   the member sees the admin-only section left out
 *
 * No MCP and no service call does any of the deciding: every act is a click,
 * and the database is only READ to check what the click did. The Tool reports
 * what it was shown through `visvine.state.set('shell', …)` — the id of the one
 * document it mounted in, every section, every band press — so "switched
 * without reloading its frame" is one mount id across every section.
 *
 * Needs `pnpm dev` running with dev auth, and Chromium
 * (`pnpm --filter @visvine/web exec playwright install chromium`). It WRITES to
 * the local database — guarded to it — and takes everything back out, first
 * and last.
 *
 *   pnpm --filter @visvine/web verify:tools:shell [spaceId]
 *
 * Env: BASE_URL (default http://localhost:3000), HEADED=1 to watch.
 */
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import prisma from '../lib/prisma';
import { ADMIN_ALIAS_ID } from '../lib/types/context';
import { LEVEL_EDIT } from '../lib/notes/shared/authz';
import { isAdmin } from '../lib/auth';
import type { SpaceFeatureConfig } from '../lib/types/space';
import { toolRailKey } from '../lib/featureAccess';
import * as store from '../lib/notes/store';
import { readSpaceConfig, updateSpaceConfig } from '../lib/spaces/spaceConfig';
import type { ActionCaller } from '../lib/actions/types';
import { appToolHandlers } from '../lib/actions/defs/apps';
import { handleBridgeCall } from '../lib/tools/bridge';
import { toolFolderPath, toolIndexPath } from '../lib/tools/config';
import { toolKey } from '../lib/tools/registry';
import { resolveBridgeTarget } from '../lib/tools/target';
import { SPACE_ID } from './seed/space';

const SPACE = process.argv[2] ?? SPACE_ID;
const TOOL = 'sections';
const TITLE = 'Sections';
const RAIL_KEY = toolRailKey(TOOL);
const MARKER = 'verify-tools-shell:sections';
const APP = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const OWN_NOTES = [`${toolFolderPath(TOOL)}/ui.md`, `${toolFolderPath(TOOL)}/data.md`, toolIndexPath(TOOL)];

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
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function sharedContext(spaceId: string): store.Context {
  return { spaceId, ownerKey: store.SHARED_OWNER_KEY };
}

interface ShellReport {
  marker: string;
  mount: string;
  section: string | null;
  seen: string[];
  pressed: string[];
}

async function cleanup(spaceId: string, dropOrder: boolean): Promise<void> {
  const key = toolKey(spaceId, TOOL);
  await prisma.appToolInstall.deleteMany({ where: { key } });
  await prisma.appToolVersion.deleteMany({ where: { key } });
  await prisma.appToolIncident.deleteMany({ where: { key } });
  await prisma.contextGrant.deleteMany({ where: { spaceId, resourcePath: { startsWith: toolFolderPath(TOOL) } } });
  const context = sharedContext(spaceId);
  for (const path of OWN_NOTES) await store.deleteNote(context, path);
  await prisma.appToolBuild.deleteMany({ where: { spaceId, name: TOOL } });
  await prisma.contextNote.deleteMany({
    where: { spaceId, ownerKey: store.SHARED_OWNER_KEY, deletedAt: { not: null }, deletedPath: { in: OWN_NOTES } },
  });
  const remaining = await prisma.contextNote.count({
    where: { spaceId, ownerKey: store.SHARED_OWNER_KEY, deletedAt: null, path: { startsWith: `${toolFolderPath(TOOL)}/` } },
  });
  if (remaining === 0) {
    await prisma.contextFolder.deleteMany({
      where: { spaceId, ownerKey: store.SHARED_OWNER_KEY, path: toolFolderPath(TOOL) },
    });
  }
  await prisma.node.deleteMany({ where: { id: `tool:${TOOL}` } });
  await updateSpaceConfig(spaceId, (stored) => {
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

async function login(browser: Browser, userId: string, email: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const res = await page.goto(`${APP}/dev/login`, { waitUntil: 'domcontentloaded' });
  if (res?.status() === 404) throw new Error('/dev/login is 404 — set NODE_ENV=development and ENABLE_DEV_AUTH=true');
  const button = page.locator(`form[action^="/api/dev/login-as/${userId}"] button`);
  if ((await button.count()) === 0) throw new Error(`${email} is not on /dev/login — dev login lists @local.dev users only`);
  await button.first().click();
  await page.waitForURL((url) => !url.pathname.startsWith('/dev/login'), { timeout: 30_000 });
  return { context, page };
}

async function until<T>(read: () => Promise<T | null>, ms: number): Promise<T | null> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await sleep(400);
  }
  return null;
}

async function main(): Promise<void> {
  const holder = await prisma.userAlias.findFirst({
    where: { spaceId: SPACE, aliasId: ADMIN_ALIAS_ID, user: { email: { endsWith: '@local.dev' } } },
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  const admin = holder?.user;
  if (!admin) throw new Error(`nobody on /dev/login manages ${SPACE}`);
  const candidates = await prisma.spaceMember.findMany({
    where: { spaceId: SPACE, status: 'active', userId: { not: admin.id }, user: { email: { endsWith: '@local.dev' } } },
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  let member: { id: string; name: string | null; email: string | null } | null = null;
  for (const row of candidates) {
    if (!(await isAdmin(row.user.id, SPACE, row.user.email ?? ''))) {
      member = row.user;
      break;
    }
  }
  if (!member) throw new Error(`${SPACE} has no member on /dev/login who is not an admin`);

  console.log(`space   ${SPACE}\nadmin   ${admin.email}\nmember  ${member.email}\napp     ${APP}`);
  const orderWasAbsent = (await readSpaceConfig(SPACE))?.featureConfig.order === undefined;
  await cleanup(SPACE, orderWasAbsent);

  let browser: Browser | null = null;
  let shotPage: Page | null = null;
  try {
    // ── 1. the member writes it ──────────────────────────────────────────────
    step('1. a member authors the Tool');
    // The seed keeps `tools/` to its admins; a space that lets members build
    // gives them the folder, which is what this grant stands for.
    await prisma.contextGrant.create({
      data: {
        spaceId: SPACE,
        subjectType: 'user',
        subjectId: member.id,
        resourcePath: toolFolderPath(TOOL),
        level: LEVEL_EDIT,
        grantedBy: admin.id,
      },
    });
    const memberCtx: ActionCaller = {
      userId: member.id,
      name: member.name ?? '',
      email: member.email ?? '',
      scopes: ['context:read', 'context:write', 'tools:author'],
    };
    await appToolHandlers.createTool(memberCtx, { space_id: SPACE, name: TOOL, title: TITLE, description: 'Sections' });
    let written = await appToolHandlers.writeTool(memberCtx, { space_id: SPACE, name: TOOL, file: 'ui.tsx', content: fixture('ui.tsx') });
    for (const file of ['data.js', 'index.md'] as const) {
      written = await appToolHandlers.writeTool(memberCtx, { space_id: SPACE, name: TOOL, file, content: fixture(file) });
    }
    check(
      'the fixture compiles with its sections and band button',
      written.build.ok && written.build.errors.length === 0 && written.build.config_error === null,
      written.build.errors.join(' | ') || `${written.build.size_bytes} bytes`,
    );

    browser = await chromium.launch({ headless: process.env.HEADED !== '1' });

    // ── 2. the member publishes from the Tool tab ────────────────────────────
    step('2. the member publishes from its Tool tab');
    const asMember = await login(browser, member.id, member.email ?? '');
    shotPage = asMember.page;
    await asMember.page.goto(`${APP}/s/${encodeURIComponent(SPACE)}/directory/tool:${TOOL}`, { waitUntil: 'domcontentloaded' });
    const publish = asMember.page.getByRole('button', { name: 'Publish', exact: true }).first();
    await publish.waitFor({ state: 'visible', timeout: 60_000 });
    await publish.click();
    const dialog = asMember.page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
    const pending = await until(
      () => prisma.appToolVersion.findFirst({ where: { key: toolKey(SPACE, TOOL) }, select: { id: true, status: true, version: true } }),
      30_000,
    );
    check(
      "a member's publish waits for an admin",
      pending?.status === 'pending',
      pending ? `v${pending.version} ${pending.status}` : 'no version row',
    );
    if (!pending) throw new Error('nothing was published');

    // ── 3. the admin approves, and the install sheet opens ───────────────────
    step('3. the admin approves on Approvals and installs into More');
    const asAdmin = await login(browser, admin.id, admin.email ?? '');
    shotPage = asAdmin.page;
    const page = asAdmin.page;
    await page.goto(`${APP}/s/${encodeURIComponent(SPACE)}/admin?section=approvals`, { waitUntil: 'domcontentloaded' });
    const row = page.locator('section').filter({ hasText: TITLE }).filter({ has: page.getByRole('button', { name: 'Approve' }) }).first();
    await row.waitFor({ state: 'visible', timeout: 60_000 });
    await row.getByRole('button', { name: 'Approve' }).click();
    const sheet = page.getByRole('dialog').filter({ hasText: `Install ${TITLE}` });
    const opened = await sheet.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
    check('approving opens the install sheet', opened, opened ? 'sheet open' : 'no sheet after Approve');
    if (!opened) throw new Error('no install sheet');
    await sheet.locator('select').first().selectOption('more');
    await sheet.getByRole('button', { name: 'Install', exact: true }).click();
    const install = await until(
      () => prisma.appToolInstall.findFirst({ where: { spaceId: SPACE, key: toolKey(SPACE, TOOL) }, select: { id: true, slug: true } }),
      30_000,
    );
    const config = (await readSpaceConfig(SPACE))?.featureConfig;
    const approved = await prisma.appToolVersion.findUnique({ where: { id: pending.id }, select: { status: true } });
    check(
      'approved, installed and placed in More without MCP',
      approved?.status === 'approved' && install !== null && (config?.more ?? []).includes(RAIL_KEY),
      `status ${approved?.status} · install ${install?.slug ?? 'none'} · more [${(config?.more ?? []).join(', ')}]`,
    );
    if (!install) throw new Error('nothing was installed');

    // ── 4. three sections, one frame ─────────────────────────────────────────
    step('4. the sections switch on the band without reloading the frame');
    const session = { userId: admin.id, name: admin.name ?? '', email: admin.email ?? '' };
    const target = await resolveBridgeTarget(session, { kind: 'install', installId: install.id });
    if ('code' in target) throw new Error(`resolveBridgeTarget: ${target.code} ${target.message}`);
    const report = async (): Promise<ShellReport | null> => {
      const answer = await handleBridgeCall(target, 'state.get', { key: 'shell' });
      const value = answer.ok ? (answer.value as ShellReport | null) : null;
      return value && value.marker === MARKER ? value : null;
    };
    const reportWhere = (accept: (r: ShellReport) => boolean) =>
      until(async () => {
        const r = await report();
        return r && accept(r) ? r : null;
      }, 30_000);

    await page.goto(`${APP}/s/${encodeURIComponent(SPACE)}/t/${TOOL}`, { waitUntil: 'domcontentloaded' });
    const frame = page.locator(`iframe[title="${TITLE}"]`);
    await frame.waitFor({ state: 'attached', timeout: 60_000 });
    const tabs = page.getByRole('tablist', { name: `${TITLE} sections` });
    await tabs.waitFor({ state: 'visible', timeout: 30_000 });
    const tabNames = await tabs.getByRole('tab').allInnerTexts();
    check(
      "the Tool's sections are the band's tabs",
      JSON.stringify(tabNames) === JSON.stringify(['Board', 'Table', 'Settings']),
      tabNames.join(' · '),
    );
    const first = await reportWhere((r) => r.section === 'board');
    check('it opens on the first section', first !== null, first ? `mount ${first.mount}` : 'no report');
    // A property on the element itself: a remounted iframe would not carry it.
    await frame.evaluate((el) => ((el as HTMLIFrameElement & { __shell?: number }).__shell = 1));

    await tabs.getByRole('tab', { name: 'Table' }).click();
    const second = await reportWhere((r) => r.section === 'table');
    check(
      'pressing a tab moves the Tool to that section',
      second !== null && new URL(page.url()).searchParams.get('section') === 'table',
      `${page.url()} · ${second ? `section ${second.section}` : 'no report'}`,
    );

    await page.frameLocator(`iframe[title="${TITLE}"]`).getByRole('button', { name: 'Open settings' }).click();
    const third = await reportWhere((r) => r.section === 'settings');
    await page.waitForURL((url) => url.searchParams.get('section') === 'settings', { timeout: 10_000 }).catch(() => {});
    check(
      'the Tool asks for a section and the page moves to it',
      third !== null && new URL(page.url()).searchParams.get('section') === 'settings' &&
        (await tabs.getByRole('tab', { name: 'Settings' }).getAttribute('aria-selected')) === 'true',
      `${page.url()} · ${third ? `seen ${third.seen.join(' → ')}` : 'no report'}`,
    );

    await page.frameLocator(`iframe[title="${TITLE}"]`).getByRole('button', { name: 'Open nowhere' }).click();
    await sleep(1_500);
    check(
      'a section it never declared goes nowhere',
      new URL(page.url()).searchParams.get('section') === 'settings',
      page.url(),
    );

    const sameElement = await frame.evaluate((el) => (el as HTMLIFrameElement & { __shell?: number }).__shell === 1);
    const last = await report();
    check(
      'one frame, one document, across all three sections',
      sameElement && first !== null && last !== null && last.mount === first.mount &&
        JSON.stringify(last.seen) === JSON.stringify(['board', 'table', 'settings']),
      `same element ${sameElement} · mounts ${first?.mount} → ${last?.mount} · seen ${last?.seen.join(' → ')}`,
    );

    // ── 5. the band button ───────────────────────────────────────────────────
    step('5. a band button reaches the Tool');
    await page.getByRole('button', { name: 'New deal', exact: true }).click();
    const pressed = await reportWhere((r) => r.pressed.includes('new-deal'));
    check('the press arrives as the declared action', pressed !== null, pressed ? pressed.pressed.join(', ') : 'no press reported');

    // ── 6. the ⋯ menu ────────────────────────────────────────────────────────
    step('6. ⋯ → About and Report');
    await page.getByRole('button', { name: `${TITLE} menu` }).click();
    await page.getByRole('menuitem', { name: 'About' }).click();
    const about = page.getByRole('dialog');
    const aboutShown = await about.getByText('Egress').waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false);
    const aboutText = aboutShown ? (await about.innerText()).replace(/\s+/g, ' ') : '';
    check('About names the release and its egress', aboutShown && /v1/.test(aboutText) && /None/.test(aboutText), aboutText.slice(0, 240));
    await page.keyboard.press('Escape');
    await about.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});

    await page.getByRole('button', { name: `${TITLE} menu` }).click();
    await page.getByRole('menuitem', { name: 'Report' }).click();
    const reportDialog = page.getByRole('dialog').filter({ hasText: `Report ${TITLE}` });
    await reportDialog.getByRole('textbox', { name: 'What is wrong' }).fill('verify-tools-shell report');
    await reportDialog.getByRole('button', { name: 'Report', exact: true }).click();
    const incident = await until(
      () => prisma.appToolIncident.findFirst({ where: { key: toolKey(SPACE, TOOL), kind: 'report' }, select: { id: true } }),
      15_000,
    );
    check('Report files an incident for the reviewers', incident !== null, incident ? incident.id : 'no incident row');

    // ── 7. the member's view ─────────────────────────────────────────────────
    step("7. a member's band leaves the admin-only section out");
    await asMember.page.goto(`${APP}/s/${encodeURIComponent(SPACE)}/t/${TOOL}?section=settings`, { waitUntil: 'domcontentloaded' });
    shotPage = asMember.page;
    const memberTabs = asMember.page.getByRole('tablist', { name: `${TITLE} sections` });
    await memberTabs.waitFor({ state: 'visible', timeout: 60_000 });
    const memberNames = await memberTabs.getByRole('tab').allInnerTexts();
    const selected = await memberTabs.locator('[aria-selected="true"]').allInnerTexts();
    check(
      "a member sees Board and Table, and an admin section's URL falls back to the first",
      JSON.stringify(memberNames) === JSON.stringify(['Board', 'Table']) && selected[0] === 'Board',
      `${memberNames.join(' · ')} · selected ${selected.join('')}`,
    );
    const menuItems = await (async () => {
      await asMember.page.getByRole('button', { name: `${TITLE} menu` }).click();
      return asMember.page.getByRole('menuitem').allInnerTexts();
    })();
    check(
      'a member is offered no Manage',
      !menuItems.includes('Manage') && menuItems.includes('About') && menuItems.includes('Report'),
      menuItems.join(' · '),
    );
  } catch (err) {
    fail++;
    console.log(`FAIL  the run stopped\n        ${err instanceof Error ? err.message : String(err)}`);
    if (shotPage) {
      const file = join(tmpdir(), `verify-tools-shell-${Date.now()}.png`);
      await shotPage.screenshot({ path: file, fullPage: true }).catch(() => {});
      console.log(`        screenshot: ${file}`);
    }
  } finally {
    await browser?.close().catch(() => {});
    await cleanup(SPACE, orderWasAbsent);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

void main();
