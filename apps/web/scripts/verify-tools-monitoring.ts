/**
 * Live check of monitoring (docs/tools.md § Monitoring): a planted navigation
 * in a staged listing suspends it and stops its installs within a minute.
 *
 *   1. "Leap" is written in the house, listed through Visvine's review — its
 *      link off Visvine hidden from the review runner, a sleeper — and
 *      installed in two other spaces.
 *   2. A member and then an admin each follow the link in a real browser: one
 *      viewer is a signal, two independent viewers hold the listing everywhere.
 *   3. Its installs stop: a bridge call answers `revoked` at once, and a frame
 *      left open elsewhere is taken down by its host within a minute.
 *   4. The reviewer's console sees the incidents and the listing; clearing and
 *      reinstating runs it again. Telemetry counted it all, the rules and the
 *      rescan run clean, and verifying the publisher lifts its stage.
 *
 * Needs `pnpm dev` and Chromium for Playwright; the AI review is scripted.
 * Cleans up after itself.
 *
 *   pnpm --filter @visvine/web verify:tools:monitoring
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
import { installVersion } from '../lib/tools/installs';
import { requestListing } from '../lib/tools/listings';
import { reviewVersion, toolKey } from '../lib/tools/registry';
import { runReviewNow } from '../lib/tools/review/run';
import { listIncidents, listListings, resolveIncident } from '../lib/tools/reviewConsole';
import { holdListing } from '../lib/tools/verdicts';
import { sweepAnomalies } from '../lib/tools/monitor';
import { rollUpTelemetry } from '../lib/tools/telemetry';
import { rescanListed } from '../lib/tools/rescan';
import { isVerifiedPublisher, setPublisherVerified } from '../lib/tools/publishers';
import { provisionSpace } from '../lib/spaces/provision';
import { purgeSpaceObjects } from '../lib/storage/purge';
import { resolveBridgeTarget } from '../lib/tools/target';
import { SPACE_ID } from './seed/space';

const HOUSE = SPACE_ID;
const TOOL = 'vg-leap';
const B_NAME = 'VG Monitor B';
const C_NAME = 'VG Monitor C';
const APP = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tools', 'global');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
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

async function openTool(context: BrowserContext, spaceId: string, slug: string): Promise<{ page: Page; frame: Frame }> {
  const page = await context.newPage();
  await page.goto(`${APP}/s/${spaceId}/t/${slug}`, { waitUntil: 'domcontentloaded' });
  const frame = await toolFrame(page);
  await frame.getByRole('button', { name: 'Refresh' }).waitFor({ timeout: 30_000 });
  return { page, frame };
}

async function listingState(listingId: string): Promise<string | null> {
  return (await prisma.appToolListing.findUnique({ where: { id: listingId }, select: { state: true } }))?.state ?? null;
}

async function cleanup(): Promise<void> {
  const spaces = await prisma.space.findMany({ where: { name: { in: [B_NAME, C_NAME] } }, select: { id: true } });
  for (const space of spaces) {
    await purgeSpaceObjects(space.id).catch(() => undefined);
    await prisma.space.delete({ where: { id: space.id } }).catch(() => undefined);
  }
  const key = toolKey(HOUSE, TOOL);
  await prisma.appToolInstall.deleteMany({ where: { key } });
  const versions = await prisma.appToolVersion.findMany({ where: { key }, select: { id: true, listingId: true } });
  const listingIds = versions.map((v) => v.listingId).filter((id): id is string => !!id);
  await prisma.appToolIncident.deleteMany({ where: { OR: [{ key }, { listingId: { in: listingIds } }] } });
  await prisma.appToolVersion.deleteMany({ where: { key } });
  await prisma.appToolListing.deleteMany({ where: { OR: [{ key }, { id: { in: listingIds } }] } });
  await prisma.appToolPublisher.deleteMany({ where: { spaceId: HOUSE } });
  await prisma.contextNote.deleteMany({ where: { spaceId: HOUSE, OR: [{ path: { startsWith: `tools/${TOOL}/` } }, { deletedPath: { startsWith: `tools/${TOOL}/` } }] } });
  await prisma.appToolBuild.deleteMany({ where: { spaceId: HOUSE, name: TOOL } });
  await prisma.appToolConfig.deleteMany({ where: { spaceId: HOUSE, name: TOOL } });
  await prisma.appToolCheckRun.deleteMany({ where: { spaceId: HOUSE, name: TOOL } });
  await prisma.node.deleteMany({ where: { id: `tool:${TOOL}`, spaceId: HOUSE } });
}

async function main(): Promise<void> {
  const admin = await prisma.user.findFirst({ where: { email: 'admin@local.dev' }, select: { id: true, name: true, email: true } });
  const member = await prisma.user.findFirst({ where: { email: 'member@local.dev' }, select: { id: true, name: true, email: true } });
  if (!admin || !member) throw new Error('admin@local.dev and member@local.dev must be seeded');
  const reviewer = { userId: admin.id, email: admin.email ?? '' };
  const ctx: ActionCaller = {
    userId: admin.id,
    name: admin.name ?? '',
    email: admin.email ?? '',
    scopes: ['context:read', 'context:write', 'tools:author', 'tools:install', 'tools:list'],
  };
  console.log(`house   ${HOUSE}\nadmin   ${admin.email}\nmember  ${member.email}\napp     ${APP}`);
  await cleanup();

  let browser: Browser | null = null;
  try {
    // ── 1. a sleeper, listed ──────────────────────────────────────────────────
    step('1. Leap is listed, staged, and installed in two spaces');
    await appToolHandlers.createTool(ctx, { space_id: HOUSE, name: TOOL, title: 'Leap', description: 'Leap' });
    await appToolHandlers.writeTool(ctx, { space_id: HOUSE, name: TOOL, file: 'index.md', content: fixture('leap-index.md') });
    const built = await appToolHandlers.writeTool(ctx, { space_id: HOUSE, name: TOOL, file: 'ui.tsx', content: fixture('leap-ui.tsx') });
    const published = await appToolHandlers.publishTool(ctx, { space_id: HOUSE, name: TOOL, release_notes: 'First.' });
    const asked = await requestListing(published.version_id, { userId: admin.id, email: admin.email ?? '', spaceId: HOUSE, isAdmin: true }, {});
    const reviewed = await runReviewNow(published.version_id, { complete: async () => JSON.stringify({ findings: [] }) });
    const listed = await reviewVersion(published.version_id, 'approved', reviewer);
    const listing = await prisma.appToolListing.findUnique({ where: { key: toolKey(HOUSE, TOOL) }, select: { id: true, stagedUntil: true } });
    check(
      'it compiles, passes Visvine’s review with its link hidden from the runner, and is listed staged',
      built.build.ok && asked.ok && reviewed !== 'blocked' && listed.ok && !!listing?.stagedUntil,
      `${built.build.ok} · ${asked.ok ? asked.state : asked.error} · review ${reviewed} · ${listed.ok ? 'listed' : listed.error}`,
    );
    if (!listing) throw new Error('no listing');

    const madeB = await provisionSpace({ name: B_NAME, visibility: 'private', creator: { id: admin.id, name: admin.name ?? 'admin', email: admin.email } });
    const madeC = await provisionSpace({ name: C_NAME, visibility: 'private', creator: { id: member.id, name: member.name ?? 'member', email: member.email } });
    if (!madeB.ok || !madeC.ok) throw new Error('could not make B and C');
    const B = madeB.space.id;
    const C = madeC.space.id;
    await prisma.spaceMember.create({ data: { userId: member.id, spaceId: B, status: 'active' } });
    const inB = await installVersion(B, published.version_id, reviewer);
    const inC = await installVersion(C, published.version_id, { userId: member.id, email: member.email ?? '' });
    check('installed in B by its admin and in C by a member who runs it', inB.ok && inC.ok, `${inB.ok ? inB.install.slug : inB.error} · ${inC.ok ? inC.install.slug : inC.error}`);
    if (!inB.ok || !inC.ok) throw new Error('installs failed');

    // ── 2. two viewers follow the link ────────────────────────────────────────
    step('2. a member, then an admin, follow its link off Visvine');
    browser = await chromium.launch({ headless: true });
    const memberCtx = await login(browser, member.id);
    const adminCtx = await login(browser, admin.id);
    const idle = await openTool(memberCtx, C, inC.install.slug);
    await idle.frame.getByRole('button', { name: 'Refresh' }).click();
    await idle.frame.getByTestId('count').filter({ hasText: 'notes' }).waitFor({ timeout: 20_000 });
    check('a frame is open in C and working', true, (await idle.frame.getByTestId('count').textContent()) ?? '');

    const first = await openTool(memberCtx, B, inB.install.slug);
    await first.frame.getByTestId('docs').click();
    await first.page.getByText('This tool tried to leave its frame and was stopped.').waitFor({ timeout: 20_000 });
    await sleep(1_000);
    check('one viewer: the host stops that frame, and the listing stands', (await listingState(listing.id)) === 'active', `listing ${await listingState(listing.id)}`);

    const second = await openTool(adminCtx, B, inB.install.slug);
    await second.frame.getByTestId('docs').click();
    await second.page.getByText('This tool tried to leave its frame and was stopped.').waitFor({ timeout: 20_000 });
    let held = 'active';
    for (let i = 0; i < 20 && held === 'active'; i++) {
      await sleep(500);
      held = (await listingState(listing.id)) ?? 'gone';
    }
    const suspendedAt = Date.now();
    const why = await prisma.appToolListing.findUnique({ where: { id: listing.id }, select: { stateReason: true, stateBy: true } });
    check(
      'a second, independent viewer: monitoring suspends the listing everywhere',
      held === 'suspended' && why?.stateBy === 'monitor',
      `${held} by ${why?.stateBy} — ${why?.stateReason}`,
    );

    // ── 3. its installs stop ──────────────────────────────────────────────────
    step('3. its installs stop');
    const target = await resolveBridgeTarget({ userId: member.id, name: member.name ?? '', email: member.email ?? '' }, { kind: 'install', installId: inC.install.id });
    const call = 'code' in target ? { ok: false as const, error: target } : await handleBridgeCall(target, 'context.list', {});
    check('a bridge call in C answers revoked at once', !call.ok && call.error.code === 'revoked', call.ok ? 'answered!' : `${call.error.code}: ${call.error.message}`);
    await idle.page.getByText(/Suspended by Visvine/).waitFor({ timeout: 75_000 });
    const elapsed = Date.now() - suspendedAt;
    check('the frame left open in C is taken down by its host within a minute', elapsed <= 60_000, `${Math.round(elapsed / 1000)}s`);
    const fresh = await memberCtx.newPage();
    await fresh.goto(`${APP}/s/${C}/t/${inC.install.slug}`, { waitUntil: 'domcontentloaded' });
    await fresh.getByText(/Suspended by Visvine/).waitFor({ timeout: 30_000 });
    check('opening it again shows why, not the Tool', true, 'Suspended by Visvine');
    const audited = await prisma.contextAuditEntry.count({ where: { spaceId: { in: [HOUSE, B, C] }, detail: { contains: 'suspended by Visvine’s monitoring' } } });
    check('the publisher and every space that installed it are told', audited >= 3, `${audited} audit lines`);

    // ── 4. the reviewer's console ─────────────────────────────────────────────
    step('4. the reviewer reads it, clears it and reinstates it');
    const incidents = (await listIncidents()).filter((i) => i.listing?.id === listing.id);
    const navigations = incidents.filter((i) => i.kind === 'navigation' && i.fromViewer);
    check('the console lists both viewers’ incidents on the listing', navigations.length === 2, incidents.map((i) => `${i.kind}/${i.severity}/${i.source}`).join(', '));
    const rows = (await listListings()).filter((l) => l.id === listing.id);
    check('and the listing, suspended, with its reason and installs', rows[0]?.state === 'suspended' && rows[0].installs === 2 && rows[0].openIncidents >= 2, JSON.stringify(rows[0] ?? {}).slice(0, 200));
    for (const incident of navigations) await resolveIncident(incident.id, reviewer, 'clear');
    const reinstated = await holdListing({ listingId: listing.id }, 'active', reviewer, 'A docs link; cleared.');
    const retarget = await resolveBridgeTarget({ userId: member.id, name: member.name ?? '', email: member.email ?? '' }, { kind: 'install', installId: inC.install.id });
    const again = 'code' in retarget ? { ok: false as const } : await handleBridgeCall(retarget, 'context.list', {});
    check('cleared and reinstated, it runs again', reinstated.ok && again.ok, reinstated.ok ? (again.ok ? 'answered' : 'refused') : reinstated.error);
    const monitorOnly = await holdListing({ listingId: listing.id }, 'revoked', 'monitor', 'x');
    check('the monitor may only ever suspend', !monitorOnly.ok, monitorOnly.ok ? 'revoked!' : monitorOnly.error);

    // ── 5. telemetry, rules, rescans, publishers ──────────────────────────────
    step('5. telemetry counted it; the rules, the rescan and verification run');
    // The server flushes on the request path once a minute has passed; one
    // more call after that minute writes what it has counted.
    await sleep(Math.max(0, 61_000 - (Date.now() - suspendedAt)));
    const reopened = await openTool(memberCtx, C, inC.install.slug);
    await reopened.frame.getByRole('button', { name: 'Refresh' }).click();
    await reopened.frame.getByTestId('count').filter({ hasText: 'notes' }).waitFor({ timeout: 20_000 });
    await sleep(1_500);
    const telemetry = await prisma.appToolTelemetry.findMany({
      where: { installId: { in: [inB.install.id, inC.install.id] } },
      select: { installId: true, calls: true, navigations: true, viewers: true, methods: true },
    });
    const calls = telemetry.reduce((acc, row) => acc + row.calls, 0);
    const navigated = telemetry.reduce((acc, row) => acc + row.navigations, 0);
    check(
      'counts only — calls by method, navigations — one row per install, day and instance',
      calls > 0 && navigated >= 2 && telemetry.every((row) => !JSON.stringify(row.methods).includes('vg-leap/')),
      `${telemetry.length} rows · ${calls} calls · ${navigated} navigations · ${JSON.stringify(telemetry[0]?.methods ?? {}).slice(0, 120)}`,
    );
    const anomalies = await sweepAnomalies();
    const rolled = await rollUpTelemetry();
    check('the anomaly rules read today quietly, and the roll-up runs', anomalies === 0, `${anomalies} anomalies · rolled ${rolled.rolled} · pruned ${rolled.pruned}`);
    const rescan = await rescanListed({ force: true });
    check('a forced rescan reads every listed version again and finds nothing new', rescan.versions >= 1 && rescan.incidents === 0, JSON.stringify(rescan));
    await setPublisherVerified(HOUSE, reviewer, true);
    const lifted = await prisma.appToolListing.findUnique({ where: { id: listing.id }, select: { stagedUntil: true } });
    check('verifying the publisher is data, and lifts its listings’ stage', (await isVerifiedPublisher(HOUSE)) && lifted?.stagedUntil === null, `verified · staged until ${lifted?.stagedUntil}`);
  } finally {
    await browser?.close().catch(() => undefined);
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
