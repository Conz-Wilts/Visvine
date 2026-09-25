/**
 * Live check of going global (docs/tools.md § Going global, § Packages):
 *
 *   1. Two Tools are written and published in the house: "Board Digest",
 *      which copies every note in its folder into one digest note, and
 *      "Tally", which counts presses into a note.
 *   2. Both are offered for listing and co-signed by their author; Visvine's
 *      review runs each — a scripted AI read and the dynamic run in a
 *      honeypot, in a real browser. Board Digest copies an admins-only
 *      canary where every member can read it: blocked, and a reviewer cannot
 *      list it. Tally runs clean and is listed, staged.
 *   3. Tally's listed version is exported — signed, naming its publisher — and
 *      imported into space B, where it is bound to B's own folder and runs;
 *      a package changed after export is refused.
 *   4. A member who runs space C finds Tally in Discover, installs it from
 *      the sheet, sees where it came from in its band, and is asked once
 *      before it first writes as them.
 *   5. Staged reach: at its cap, one more space is refused.
 *   6. The listing moves from the house to B; B lists a new version, and C —
 *      which installed the house's — is offered it and upgrades.
 *
 * Needs `pnpm dev` started with TOOLS_DIRECTORY=open (so a member sees the
 * directory) and Chromium for Playwright. Spends no model key: the AI review
 * is scripted. Cleans up after itself.
 *
 *   pnpm --filter @visvine/web verify:tools:global
 */
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from 'playwright';
import prisma from '../lib/prisma';
import * as store from '../lib/notes/store';
import { principalOf, resolveContext } from '../lib/notes/resolve';
import type { ActionCaller } from '../lib/actions/types';
import { appToolHandlers } from '../lib/actions/defs/apps';
import { handleBridgeCall } from '../lib/tools/bridge';
import { applyUpgrade, installVersion, listInstalls } from '../lib/tools/installs';
import { answerTransfer, offerTransfer, requestListing } from '../lib/tools/listings';
import { reviewVersion, toolKey } from '../lib/tools/registry';
import { runReviewNow } from '../lib/tools/review/run';
import { exportVersion, exportWorkingCopy, importPackage } from '../lib/tools/package';
import { provisionSpace } from '../lib/spaces/provision';
import { purgeSpaceObjects } from '../lib/storage/purge';
import { resolveBridgeTarget } from '../lib/tools/target';
import type { BridgeMethod, BridgeResponse } from '../lib/tools/protocol';
import { SPACE_ID } from './seed/space';

const HOUSE = SPACE_ID;
const DIGEST = 'vg-digest';
const TALLY = 'vg-tally';
const B_NAME = 'VG Publisher B';
const C_NAME = 'VG Installer C';
const B_FOLDER = 'vg-b-counts';
const APP = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tools', 'global');

const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const shared = (spaceId: string): store.Context => ({ spaceId, ownerKey: store.SHARED_OWNER_KEY });

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

/** The AI review, scripted: a flag for the digest, nothing for the tally. Nothing is spent. */
const scriptedAi = (answer: object) => ({ complete: async () => JSON.stringify(answer) });

async function toolWrite(ctx: ActionCaller, spaceId: string, name: string, file: 'index.md' | 'ui.tsx', content: string) {
  return appToolHandlers.writeTool(ctx, { space_id: spaceId, name, file, content });
}

async function publish(ctx: ActionCaller, spaceId: string, name: string, releaseNotes: string) {
  return appToolHandlers.publishTool(ctx, { space_id: spaceId, name, release_notes: releaseNotes });
}

async function bridge(userId: string, name: string, email: string, target: unknown, method: BridgeMethod, params: unknown): Promise<BridgeResponse> {
  const resolved = await resolveBridgeTarget({ userId, name, email }, target);
  if ('code' in resolved) return { ok: false, error: resolved };
  return handleBridgeCall(resolved, method, params);
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

async function toolFrame(page: Page): Promise<Frame> {
  await page.waitForSelector('iframe', { state: 'attached', timeout: 30_000 });
  for (let i = 0; i < 60; i++) {
    const frame = page.frames().find((f) => f.url().includes('/api/tools/runtime/frame'));
    if (frame) return frame;
    await page.waitForTimeout(250);
  }
  throw new Error('no tool frame on the page');
}

async function cleanup(): Promise<void> {
  const spaces = await prisma.space.findMany({
    where: { OR: [{ name: { in: [B_NAME, C_NAME] } }, { name: { startsWith: 'Review ' }, members: { some: { user: { email: { endsWith: '@system.visvine.invalid' } } } } }] },
    select: { id: true },
  });
  for (const space of spaces) {
    await purgeSpaceObjects(space.id).catch(() => undefined);
    await prisma.space.delete({ where: { id: space.id } }).catch(() => undefined);
  }
  const keys = [toolKey(HOUSE, DIGEST), toolKey(HOUSE, TALLY)];
  const spaceKeys = spaces.map((s) => `${s.id}/`);
  await prisma.appToolInstall.deleteMany({ where: { OR: [{ key: { in: keys } }, ...spaceKeys.map((p) => ({ key: { startsWith: p } }))] } });
  const versions = await prisma.appToolVersion.findMany({
    where: { OR: [{ key: { in: keys } }, ...spaceKeys.map((p) => ({ key: { startsWith: p } }))] },
    select: { id: true, listingId: true },
  });
  await prisma.appToolVersion.deleteMany({ where: { id: { in: versions.map((v) => v.id) } } });
  await prisma.appToolListing.deleteMany({
    where: { OR: [{ key: { in: keys } }, { id: { in: versions.map((v) => v.listingId).filter((id): id is string => !!id) } }] },
  });
  for (const name of [DIGEST, TALLY]) {
    const folder = `tools/${name}`;
    await prisma.contextNote.deleteMany({ where: { spaceId: HOUSE, OR: [{ path: { startsWith: `${folder}/` } }, { deletedPath: { startsWith: `${folder}/` } }] } });
    await prisma.appToolBuild.deleteMany({ where: { spaceId: HOUSE, name } });
    await prisma.appToolConfig.deleteMany({ where: { spaceId: HOUSE, name } });
    await prisma.appToolCheckRun.deleteMany({ where: { spaceId: HOUSE, name } });
    await prisma.node.deleteMany({ where: { id: `tool:${name}`, spaceId: HOUSE } });
  }
}

async function main(): Promise<void> {
  const admin = await prisma.user.findFirst({ where: { email: 'admin@local.dev' }, select: { id: true, name: true, email: true } });
  const member = await prisma.user.findFirst({ where: { email: 'member@local.dev' }, select: { id: true, name: true, email: true } });
  if (!admin || !member) throw new Error('admin@local.dev and member@local.dev must be seeded');
  const reviewer = (process.env.SUPER_ADMIN_EMAILS ?? '').split(',').map((e) => e.trim()).find(Boolean);
  if (!reviewer) throw new Error('SUPER_ADMIN_EMAILS is empty — no reviewer');
  const ctx: ActionCaller = {
    userId: admin.id,
    name: admin.name ?? '',
    email: admin.email ?? '',
    scopes: ['context:read', 'context:write', 'tools:author', 'tools:install', 'tools:list'],
  };
  const adminActor = (spaceId: string) => ({ userId: admin.id, email: admin.email ?? '', spaceId, isAdmin: true });
  console.log(`house   ${HOUSE}\nadmin   ${admin.email}\nmember  ${member.email}\napp     ${APP}`);
  await cleanup();

  let browser: Browser | null = null;
  try {
    // ── 1. two Tools ──────────────────────────────────────────────────────────
    step('1. Board Digest and Tally, published in the house');
    for (const [name, title] of [[DIGEST, 'Board Digest'], [TALLY, 'Tally']] as const) {
      await appToolHandlers.createTool(ctx, { space_id: HOUSE, name, title, description: title });
    }
    await toolWrite(ctx, HOUSE, DIGEST, 'index.md', fixture('digest-index.md'));
    const digestBuild = await toolWrite(ctx, HOUSE, DIGEST, 'ui.tsx', fixture('digest-ui.tsx'));
    await toolWrite(ctx, HOUSE, TALLY, 'index.md', fixture('tally-index.md'));
    const tallyBuild = await toolWrite(ctx, HOUSE, TALLY, 'ui.tsx', fixture('tally-ui.tsx').replace('ADD_LABEL', 'Add one'));
    check('both compile', digestBuild.build.ok && tallyBuild.build.ok, `${digestBuild.build.errors.join(' | ')}${tallyBuild.build.errors.join(' | ')}` || 'ok');
    const digestV = await publish(ctx, HOUSE, DIGEST, 'First.');
    const tallyV = await publish(ctx, HOUSE, TALLY, 'First.');
    const tallyRow = await prisma.appToolVersion.findUnique({ where: { id: tallyV.version_id }, select: { digests: true, packageDigest: true } });
    check(
      'published and approved in the house, each file digested',
      digestV.status === 'approved' && tallyV.status === 'approved' && !!tallyRow?.packageDigest && 'src/ui.tsx' in (tallyRow.digests as object),
      `${digestV.status} · ${tallyV.status} · ${tallyRow?.packageDigest?.slice(0, 12)}`,
    );

    // ── 2. offered, co-signed, reviewed ───────────────────────────────────────
    step('2. offered for listing, co-signed, and reviewed by Visvine');
    const digestAsk = await requestListing(digestV.version_id, adminActor(HOUSE), {});
    const tallyAsk = await requestListing(tallyV.version_id, adminActor(HOUSE), {});
    check(
      'the author asking co-signs in the same act; the license comes from the manifest or is asked for',
      !digestAsk.ok && /license/i.test(digestAsk.error) && tallyAsk.ok && tallyAsk.state === 'in_review' && tallyAsk.version.license === 'MIT',
      `${digestAsk.ok ? digestAsk.state : digestAsk.error} · ${tallyAsk.ok ? `${tallyAsk.state} ${tallyAsk.version.license}` : tallyAsk.error}`,
    );
    const digestAsk2 = await requestListing(digestV.version_id, adminActor(HOUSE), { license: 'Apache-2.0' });
    check('with a license it goes to Visvine', digestAsk2.ok && digestAsk2.state === 'in_review', digestAsk2.ok ? digestAsk2.state : digestAsk2.error);

    const early = await reviewVersion(tallyV.version_id, 'approved', { userId: admin.id, email: reviewer });
    check('a reviewer cannot list it before its review has run', !early.ok && /not finished/.test(early.error), early.ok ? 'listed!' : early.error);

    const digestReview = await runReviewNow(digestV.version_id, scriptedAi({
      findings: [{ severity: 'high', file: 'src/ui.tsx', line: 16, message: 'Writes every note it reads into one note.' }],
    }));
    const digestReport = await prisma.appToolCheckRun.findMany({ where: { versionId: digestV.version_id, trigger: 'review' }, select: { stage: true, status: true, findings: true } });
    const dynamicDigest = digestReport.find((r) => r.stage === 'dynamic');
    const aiDigest = digestReport.find((r) => r.stage === 'ai');
    check(
      'Board Digest copied an admins-only canary where everyone can read it: the dynamic run blocks it',
      digestReview === 'blocked' && dynamicDigest?.status === 'blocked' && JSON.stringify(dynamicDigest.findings).includes('dynamic.canary-write-out'),
      `${digestReview} · ${JSON.stringify(dynamicDigest?.findings ?? []).slice(0, 220)}`,
    );
    check(
      'the AI review only flags — its "high" is read as medium',
      aiDigest?.status === 'flagged' && JSON.stringify(aiDigest.findings).includes('"severity":"medium"'),
      JSON.stringify(aiDigest?.findings ?? []).slice(0, 160),
    );
    const blocked = await reviewVersion(digestV.version_id, 'approved', { userId: admin.id, email: reviewer });
    check('a reviewer cannot list what the dynamic run blocked', !blocked.ok && /blocked/.test(blocked.error), blocked.ok ? 'listed!' : blocked.error);

    const tallyReview = await runReviewNow(tallyV.version_id, scriptedAi({ findings: [] }));
    const tallyRun = await prisma.appToolReviewRun.findFirst({ where: { versionId: tallyV.version_id }, orderBy: { createdAt: 'desc' }, select: { status: true, runner: true, honeypotSpaceId: true } });
    const events = await prisma.appToolCheckRun.findFirst({ where: { versionId: tallyV.version_id, stage: 'dynamic' }, select: { status: true, findings: true } });
    check(
      'Tally runs clean in its honeypot, in a real browser',
      (tallyReview === 'passed' || tallyReview === 'flagged') && events?.status !== 'blocked' && tallyRun?.runner === 'local',
      `${tallyReview} · ${tallyRun?.runner} · ${JSON.stringify(events?.findings ?? []).slice(0, 160)}`,
    );
    const honeypots = await prisma.space.count({ where: { id: { in: [tallyRun?.honeypotSpaceId ?? ''].filter(Boolean) } } });
    check('the honeypot is gone when its run ends', honeypots === 0, `${honeypots} left`);
    const listed = await reviewVersion(tallyV.version_id, 'approved', { userId: admin.id, email: reviewer });
    const listing = await prisma.appToolListing.findUnique({ where: { key: toolKey(HOUSE, TALLY) }, select: { id: true, listedAt: true, stagedUntil: true, stagedCap: true, license: true, authorUserId: true } });
    check(
      'a reviewer lists Tally; its first listing from an unverified publisher is staged',
      listed.ok && !!listing?.listedAt && !!listing.stagedUntil && listing.stagedCap === 25 && listing.license === 'MIT' && listing.authorUserId === admin.id,
      listed.ok ? `listed · staged until ${listing?.stagedUntil?.toISOString().slice(0, 10)} · cap ${listing?.stagedCap}` : listed.error,
    );
    if (!listing) throw new Error('no listing');

    // ── 3. export, import, bind, run ──────────────────────────────────────────
    step('3. exported from the house, imported into B, bound and run');
    const madeB = await provisionSpace({ name: B_NAME, visibility: 'private', creator: { id: admin.id, name: admin.name ?? 'admin', email: admin.email } });
    const madeC = await provisionSpace({ name: C_NAME, visibility: 'private', creator: { id: member.id, name: member.name ?? 'member', email: member.email } });
    if (!madeB.ok || !madeC.ok) throw new Error('could not make B and C');
    const B = madeB.space.id;
    const C = madeC.space.id;
    const exported = await exportVersion(tallyV.version_id, { userId: admin.id, email: admin.email ?? '' });
    if (!exported.ok) throw new Error(exported.error);
    const files = unzipSync(exported.bytes);
    const manifest = JSON.parse(strFromU8(files['visvine-tool.json'])) as { publisher?: { name?: string }; version?: number };
    check(
      'a listed version exports signed, naming its publisher and release',
      exported.signed && !!files['.visvine/SIGNATURE'] && !!files['.visvine/CHECKSUMS'] && manifest.publisher?.name !== undefined && manifest.version === 1,
      `${exported.filename} · ${exported.bytes.byteLength} bytes · signed ${exported.signed} · ${manifest.publisher?.name}`,
    );
    const working = await exportWorkingCopy(await principalOf(await resolveOrThrow(admin, HOUSE)), shared(HOUSE), TALLY);
    check(
      'a working copy exports unsigned, naming no space',
      working.ok && !working.signed && working.publisher === null && !strFromU8(unzipSync(working.bytes)['visvine-tool.json']).includes('publisher'),
      working.ok ? `${working.filename}` : working.error,
    );

    const tampered = { ...files, 'src/ui.tsx': strToU8(`${strFromU8(files['src/ui.tsx'])}\n// one more line\n`) };
    const bP = await principalOf(await resolveOrThrow(admin, B));
    const refused = await importPackage(bP, shared(B), zipSync(tampered), {});
    check('a package changed after export is refused', !refused.ok && /changed after/.test(refused.error), refused.ok ? 'imported!' : refused.error);

    const imported = await importPackage(bP, shared(B), exported.bytes, {});
    check(
      'imported into B as a working copy — under the next free name, the house holding its own — the signature naming who published it',
      imported.ok && imported.buildOk && imported.renamedFrom === TALLY && imported.provenance?.publisher === manifest.publisher?.name && imported.problems.length === 0,
      imported.ok ? `${imported.name} (was ${imported.renamedFrom}) · from ${imported.provenance?.publisher} · compiles ${imported.buildOk}` : imported.error,
    );
    if (!imported.ok) throw new Error(imported.error);
    const B_TALLY = imported.name;
    const bVersion = await publish(ctx, B, B_TALLY, 'Imported.');
    const bInstall = await installVersion(B, bVersion.version_id, { userId: admin.id, email: admin.email ?? '' }, { bindings: { notes: B_FOLDER } });
    check('published in B and installed, bound to B\'s own folder', bInstall.ok && bInstall.install.bindings.notes === B_FOLDER, bInstall.ok ? JSON.stringify(bInstall.install.bindings) : bInstall.error);
    if (!bInstall.ok) throw new Error(bInstall.error);
    const target = { kind: 'install', installId: bInstall.install.id };
    const wrote = await bridge(admin.id, admin.name ?? '', admin.email ?? '', target, 'context.write', { path: `${B_FOLDER}/tally.md`, content: '# Tally\n\n1 presses\n' });
    const house = await bridge(admin.id, admin.name ?? '', admin.email ?? '', target, 'context.write', { path: 'vg-tally/tally.md', content: 'x' });
    check(
      'it runs in B: it writes to the folder B bound, and not to the one it suggested',
      wrote.ok && !house.ok && house.error.code === 'perimeter',
      `${wrote.ok ? 'wrote' : wrote.error.message} · ${house.ok ? 'wrote the suggestion!' : house.error.code}`,
    );

    // ── 4. Discover ───────────────────────────────────────────────────────────
    step('4. a member who runs C installs Tally from Discover');
    browser = await chromium.launch({ headless: true });
    const { page } = await login(browser, member.id);
    await page.goto(`${APP}/discover?view=tools`, { waitUntil: 'domcontentloaded' });
    const card = page.getByRole('button', { name: /Tally/ }).first();
    await card.waitFor({ timeout: 30_000 });
    check('Tally is in Discover → Tools', await card.isVisible(), 'card shown');
    await card.click();
    const install = page.getByRole('button', { name: 'Install', exact: true });
    await install.waitFor({ timeout: 20_000 });
    await install.click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Install Tally' });
    await dialog.waitFor({ timeout: 20_000 });
    const facts = await dialog.textContent();
    check(
      'the sheet says who published it, that Visvine reviewed it, how widely it runs and its license, and what it can do',
      !!facts && facts.includes('reviewed') && facts.includes('MIT') && facts.includes('Reads and edits notes in'),
      (facts ?? '').replace(/\s+/g, ' ').slice(0, 200),
    );
    await dialog.getByRole('combobox').first().selectOption(C);
    await page.waitForTimeout(800);
    await dialog.getByRole('button', { name: 'Install', exact: true }).click();
    await page.getByText(/Tally installed in/).waitFor({ timeout: 30_000 });
    const cInstall = (await listInstalls(C)).find((row) => row.key === toolKey(HOUSE, TALLY));
    const cRow = cInstall ? await prisma.appToolInstall.findUnique({ where: { id: cInstall.id }, select: { listingId: true } }) : null;
    check(
      'installed in C, following the listing, bound to the suggestion C now has',
      !!cInstall && cRow?.listingId === listing.id && cInstall.bindings.notes === 'vg-tally',
      cInstall ? `${cInstall.slug} · ${JSON.stringify(cInstall.bindings)}` : 'no install',
    );
    if (!cInstall) throw new Error('no install in C');

    await page.goto(`${APP}/s/${C}/t/${cInstall.slug}`, { waitUntil: 'domcontentloaded' });
    const frame = await toolFrame(page);
    await frame.getByRole('button', { name: 'Add one' }).waitFor({ timeout: 30_000 });
    const band = await page.getByText(/reviewed by Visvine/).first().textContent().catch(() => null);
    check('its band says where it came from', !!band && band.startsWith('From '), band ?? 'no provenance line');
    await frame.getByRole('button', { name: 'Add one' }).click();
    const notice = page.getByRole('dialog').filter({ hasText: 'as you' });
    await notice.waitFor({ timeout: 20_000 });
    const sentence = (await notice.textContent()) ?? '';
    check(
      'before it first writes as the member it asks, in one sentence',
      /Tally from .+ will edit notes in vg-tally\/ as you\./.test(sentence.replace(/\s+/g, ' ')),
      sentence.replace(/\s+/g, ' ').slice(0, 160),
    );
    await notice.getByRole('button', { name: 'Continue' }).click();
    await frame.getByTestId('count').filter({ hasText: '1' }).waitFor({ timeout: 20_000 });
    const consent = await prisma.appToolConsent.findUnique({ where: { app_tool_consent_identity: { installId: cInstall.id, userId: member.id } }, select: { acting: true } });
    const tallyNote = await store.readNoteOrNull(shared(C), 'vg-tally/tally.md');
    check('Continue is remembered, and the write lands', !!consent && !!tallyNote, `${JSON.stringify(consent?.acting)} · ${tallyNote ? 'note written' : 'no note'}`);
    await frame.getByRole('button', { name: 'Add one' }).click();
    await frame.getByTestId('count').filter({ hasText: '2' }).waitFor({ timeout: 20_000 });
    check('and not asked again', (await page.getByRole('dialog').filter({ hasText: 'as you' }).count()) === 0, 'no second notice');

    // ── 5. staged reach ───────────────────────────────────────────────────────
    step('5. staged reach holds at its cap');
    await prisma.appToolListing.update({ where: { id: listing.id }, data: { stagedCap: 1 } });
    const capped = await installVersion(B, tallyV.version_id, { userId: admin.id, email: admin.email ?? '' });
    check('at its cap, one more space is refused', !capped.ok && /can be installed in 1 space until/.test(capped.error), capped.ok ? 'installed!' : capped.error);
    await prisma.appToolListing.update({ where: { id: listing.id }, data: { stagedCap: 25 } });

    // ── 6. transfer ───────────────────────────────────────────────────────────
    step('6. the listing moves to B, and C keeps its upgrades');
    const offered = await offerTransfer({ key: toolKey(HOUSE, TALLY) }, adminActor(HOUSE), B);
    const accepted = await answerTransfer(listing.id, adminActor(B), { accept: true, name: B_TALLY });
    const moved = await prisma.appToolListing.findUnique({ where: { id: listing.id }, select: { key: true, publisherSpaceId: true } });
    check(
      'offered by the house, accepted by B: the listing names B\'s Tool and keeps its id',
      offered.ok && accepted.ok && moved?.key === toolKey(B, B_TALLY) && moved.publisherSpaceId === B,
      `${offered.ok ? 'offered' : offered.error} · ${accepted.ok ? 'accepted' : accepted.error} · ${moved?.key}`,
    );
    await toolWrite(ctx, B, B_TALLY, 'ui.tsx', fixture('tally-ui.tsx').replace('ADD_LABEL', 'Count'));
    const b2 = await publish(ctx, B, B_TALLY, 'Says Count.');
    const b2Ask = await requestListing(b2.version_id, adminActor(B), {});
    const b2Review = await runReviewNow(b2.version_id, scriptedAi({ findings: [] }));
    const b2Listed = await reviewVersion(b2.version_id, 'approved', { userId: admin.id, email: reviewer });
    const b2Row = await prisma.appToolVersion.findUnique({ where: { id: b2.version_id }, select: { listingId: true } });
    check(
      'B lists its new version under the same listing',
      b2Ask.ok && b2Review !== 'blocked' && b2Listed.ok && b2Row?.listingId === listing.id,
      `${b2Ask.ok ? b2Ask.state : b2Ask.error} · ${b2Review} · ${b2Listed.ok ? `upgraded ${b2Listed.upgraded}` : b2Listed.error}`,
    );
    const offeredC = await prisma.appToolInstall.findUnique({ where: { id: cInstall.id }, select: { pendingVersionId: true } });
    check('C, which installed the house\'s version, is offered B\'s', offeredC?.pendingVersionId === b2.version_id, `${offeredC?.pendingVersionId}`);
    const upgraded = await applyUpgrade(C, cInstall.id, { userId: member.id, email: member.email ?? '' });
    const after = await prisma.appToolInstall.findUnique({ where: { id: cInstall.id }, select: { versionId: true, key: true, listingId: true } });
    check(
      'C upgrades onto it: the install now runs B\'s version, still following the listing',
      upgraded.ok && after?.versionId === b2.version_id && after.key === toolKey(B, B_TALLY) && after.listingId === listing.id,
      upgraded.ok ? `${after?.key} · v${upgraded.install.version}` : upgraded.error,
    );
  } finally {
    await browser?.close().catch(() => undefined);
    await cleanup();
    await prisma.$disconnect();
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

async function resolveOrThrow(user: { id: string; name: string | null; email: string | null }, spaceId: string) {
  const resolved = await resolveContext({ userId: user.id, name: user.name ?? '', email: user.email ?? '' }, spaceId);
  if (resolved instanceof Response) throw new Error(`resolveContext ${spaceId}: ${resolved.status}`);
  return resolved;
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
