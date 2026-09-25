/**
 * Live check of the starter repo and the CLI (docs/tools.md § Your own repo):
 * a fresh clone of packages/tool-starter, with the kit and the CLI installed
 * from their packed tarballs as npm would install them, run through its
 * README against the local server.
 *
 *   1. The packages build and pack; the clone installs.
 *   2. check, the types, and dev — the Tool offline in its frame, a write, the
 *      components, a member's view.
 *   3. login through the real OAuth consent; whoami; push; the preview in the
 *      app renders from the space's own notes; publish.
 *   4. A deploy key: push and check with it, a publish that waits, another
 *      tool and another action refused, revoked and refused.
 *   5. pack, then import the package into another space; init a second Tool.
 *
 * Needs `pnpm dev` (dev auth on), network for npm, and Chromium for
 * Playwright. Cleans up after itself.
 *
 *   pnpm --filter @visvine/web verify:tools:starter
 */
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from 'playwright';
import prisma from '../lib/prisma';
import { resolveContext, principalOf } from '../lib/notes/resolve';
import { mintDeployKey, revokeDeployKey } from '../lib/tools/deployKeys';
import { importPackage } from '../lib/tools/package';
import { toolKey } from '../lib/tools/registry';
import { SPACE_ID } from './seed/space';

const HOUSE = SPACE_ID;
const OTHER = 'investments';
const TOOL = 'vg-starter-board';
const FOLDER = 'vg-starter-board';
const APP = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const ROOT = resolve(process.cwd().endsWith('web') ? '../..' : '.');
const WORK = mkdtempSync(join(tmpdir(), 'visvine-starter-'));
const CLONE = join(WORK, 'board');
const CONFIG = join(WORK, 'config');
const DEV_PORT = 4813;

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, detail: string): boolean {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n        ${detail.split('\n').join('\n        ')}`);
  return ok;
}
function step(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(1, 58 - title.length))}`);
}

/** The shell a person runs these in: none of the npm settings pnpm leaves in this process's environment. */
const SHELL = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_/i.test(key))) as NodeJS.ProcessEnv

function run(command: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): { code: number; out: string } {
  const result = spawnSync(command, args, {
    cwd: opts.cwd ?? CLONE,
    env: { ...SHELL, VISVINE_CONFIG_DIR: CONFIG, NO_COLOR: '1', ...opts.env },
    encoding: 'utf8',
    timeout: 300_000,
  });
  return { code: result.status ?? 1, out: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

const cli = (args: string[], env: Record<string, string> = {}) => run('npx', ['--no-install', 'visvine-tool', ...args], { env });

async function login(browser: Browser, userId: string): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  await page.goto(`${APP}/dev/login`, { waitUntil: 'domcontentloaded' });
  await page.locator(`form[action^="/api/dev/login-as/${userId}"] button`).first().click();
  await page.waitForURL((url) => !url.pathname.startsWith('/dev/login'), { timeout: 30_000 });
  await page.close();
  return context;
}

async function frameOf(page: Page, match: string): Promise<Frame> {
  for (let i = 0; i < 120; i++) {
    const frame = page.frames().find((f) => f.url().includes(match));
    if (frame) return frame;
    await page.waitForTimeout(250);
  }
  throw new Error(`no frame matching ${match}`);
}

async function cleanup(): Promise<void> {
  for (const [spaceId, name] of [[HOUSE, TOOL], [OTHER, TOOL], [OTHER, `${TOOL}-2`], [HOUSE, 'second']] as const) {
    const key = toolKey(spaceId, name);
    await prisma.appToolInstall.deleteMany({ where: { key } });
    await prisma.appToolVersion.deleteMany({ where: { key } });
    await prisma.appToolDeployKey.deleteMany({ where: { spaceId, toolName: name } });
    await prisma.contextNote.deleteMany({ where: { spaceId, OR: [{ path: { startsWith: `tools/${name}/` } }, { deletedPath: { startsWith: `tools/${name}/` } }] } });
    await prisma.appToolBuild.deleteMany({ where: { spaceId, name } });
    await prisma.appToolConfig.deleteMany({ where: { spaceId, name } });
    await prisma.appToolCheckRun.deleteMany({ where: { spaceId, name } });
    await prisma.node.deleteMany({ where: { id: `tool:${name}`, spaceId } });
  }
  await prisma.contextNote.deleteMany({ where: { spaceId: HOUSE, OR: [{ path: { startsWith: `${FOLDER}/` } }, { deletedPath: { startsWith: `${FOLDER}/` } }] } });
  await prisma.contextFolder.deleteMany({ where: { spaceId: HOUSE, path: { startsWith: FOLDER } } }).catch(() => undefined);
}

async function main(): Promise<void> {
  const adminRow = await prisma.user.findFirst({ where: { email: 'admin@local.dev' }, select: { id: true, name: true, email: true } });
  if (!adminRow) throw new Error('admin@local.dev must be seeded');
  console.log(`house   ${HOUSE}\napp     ${APP}\nwork    ${WORK}`);
  await cleanup();
  const children: ChildProcess[] = [];
  let browser: Browser | null = null;
  try {
    // ── 1. build, pack, clone, install ────────────────────────────────────────
    step('1. the packages build and pack; a fresh clone installs them');
    const built = run('pnpm', ['--filter', '@visvine/web', 'tools:packages'], { cwd: ROOT });
    check('the kit, the runtime, the CLI and the starter docs build', built.code === 0, built.out.split('\n').slice(-4).join(' · '));
    for (const pkg of ['tool-kit', 'tool-cli']) run('pnpm', ['pack', '--pack-destination', WORK], { cwd: join(ROOT, 'packages', pkg) });
    const tarballs = readdirSync(WORK).filter((f) => f.endsWith('.tgz'));
    const kitTgz = tarballs.find((f) => f.startsWith('visvine-tool-kit'));
    const cliTgz = tarballs.find((f) => f.startsWith('visvine-tool-cli'));
    check('both pack as npm tarballs', !!kitTgz && !!cliTgz, tarballs.join(', '));
    if (!kitTgz || !cliTgz) throw new Error('no tarballs');

    cpSync(join(ROOT, 'packages', 'tool-starter'), CLONE, { recursive: true, filter: (src) => !/node_modules|[\\/]\.visvine/.test(src) });
    const pkgPath = join(CLONE, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { devDependencies: Record<string, string>; overrides?: Record<string, string> };
    // What `npm install` of the published packages would give: the tarballs, standing in for the registry.
    pkg.devDependencies['@visvine/tool-kit'] = `file:${join(WORK, kitTgz)}`;
    pkg.devDependencies['@visvine/tool-cli'] = `file:${join(WORK, cliTgz)}`;
    pkg.overrides = { '@visvine/tool-kit': `file:${join(WORK, kitTgz)}` };
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    const manifestPath = join(CLONE, 'visvine-tool.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name: string; bindings: { notes: { suggest: string } } };
    manifest.name = TOOL;
    manifest.bindings.notes.suggest = FOLDER;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(join(CLONE, 'fixtures', 'space.json'), JSON.stringify({ viewer: { name: 'Ada', isAdmin: true }, bindings: { notes: 'board' } }, null, 2));
    const installed = run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error']);
    check('npm install', installed.code === 0 && existsSync(join(CLONE, 'node_modules', '.bin', 'visvine-tool')), installed.out.slice(-300) || 'installed');

    // ── 2. offline ────────────────────────────────────────────────────────────
    step('2. check, the types, and dev — offline');
    const checked = cli(['check']);
    check('visvine-tool check: the server’s compiler and checks, locally', checked.code === 0 && /passes the checks/.test(checked.out), checked.out);
    const typed = run('npx', ['--no-install', 'tsc', '--noEmit']);
    check('the kit’s types check the starter’s code', typed.code === 0, typed.out || 'tsc: no errors');

    browser = await chromium.launch({ headless: true });
    const dev = spawn('npx', ['--no-install', 'visvine-tool', 'dev', '--port', String(DEV_PORT)], { cwd: CLONE, env: { ...SHELL, NO_COLOR: '1' } });
    children.push(dev);
    let devOut = '';
    dev.stdout?.on('data', (d) => (devOut += String(d)));
    dev.stderr?.on('data', (d) => (devOut += String(d)));
    for (let i = 0; i < 100 && !devOut.includes(`localhost:${DEV_PORT}`); i++) await new Promise((r) => setTimeout(r, 200));
    const offline = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await offline.goto(`http://localhost:${DEV_PORT}/`, { waitUntil: 'domcontentloaded' });
    const toolFrame = await frameOf(offline, 'kind=tool');
    await toolFrame.getByText('Launch plan').waitFor({ timeout: 30_000 });
    await toolFrame.getByText(/3 notes ·/).waitFor({ timeout: 30_000 });
    check('dev serves the Tool in its frame, answered from fixtures — data.js included', true, (await toolFrame.getByText(/notes ·/).textContent()) ?? '');
    const csp = spawnSync('curl', ['-s', '-I', `http://127.0.0.1:${DEV_PORT}/__frame?kind=tool`], { encoding: 'utf8' }).stdout;
    check('under the production frame policy', /connect-src 'none'/.test(csp) && /frame-ancestors http:\/\/localhost/.test(csp), (csp.match(/content-security-policy: (.*)/i)?.[1] ?? '').slice(0, 120));
    await toolFrame.getByPlaceholder('New note').fill('Budget review');
    await toolFrame.getByRole('button', { name: 'Add' }).click();
    await toolFrame.getByText('Budget review').waitFor({ timeout: 10_000 });
    await toolFrame.getByText(/4 notes ·/).waitFor({ timeout: 10_000 });
    check('a write lands in the offline space and the Tool sees it live', true, (await toolFrame.getByText(/notes ·/).textContent()) ?? '');
    await offline.getByRole('button', { name: 'Member' }).click();
    await offline.locator('#status').filter({ hasText: 'member' }).waitFor({ timeout: 10_000 });
    const memberFrame = await frameOf(offline, 'kind=tool');
    await memberFrame.getByText('Budget review').waitFor({ timeout: 10_000 });
    check('Member shows the same Tool as a member sees it', true, (await offline.locator('#status').textContent()) ?? '');
    await offline.getByRole('tab', { name: 'Components' }).click();
    const gallery = await frameOf(offline, 'kind=gallery');
    await gallery.getByText('KanbanBoard').first().waitFor({ timeout: 30_000 });
    check('Components draws the kit’s catalog', true, `${await gallery.locator('section').count()} components`);
    const calls = await offline.locator('#calls li').allTextContents();
    check('every call is listed with how it was answered', calls.some((c) => c.includes('context.write')) && calls.some((c) => c.includes('data.call')), calls.slice(0, 6).join(' | '));
    dev.kill('SIGINT');

    // ── 3. the server ─────────────────────────────────────────────────────────
    step('3. login, push, the preview in the app, publish');
    const admin = await login(browser, adminRow.id);
    const signin = spawn('npx', ['--no-install', 'visvine-tool', 'login', '--server', APP, '--no-browser'], {
      cwd: CLONE,
      env: { ...SHELL, VISVINE_CONFIG_DIR: CONFIG, NO_COLOR: '1' },
    });
    children.push(signin);
    let signinOut = '';
    signin.stdout?.on('data', (d) => (signinOut += String(d)));
    signin.stderr?.on('data', (d) => (signinOut += String(d)));
    for (let i = 0; i < 100 && !/https?:\/\/\S+authorize\S+/.test(signinOut); i++) await new Promise((r) => setTimeout(r, 200));
    const authorizeUrl = /(https?:\/\/\S+authorize\S+)/.exec(signinOut)?.[1];
    if (!authorizeUrl) throw new Error(`no authorize URL: ${signinOut}`);
    const consent = await admin.newPage();
    await consent.goto(authorizeUrl, { waitUntil: 'domcontentloaded' });
    const scopes = await consent.locator('body').textContent();
    await consent.getByRole('button', { name: 'Approve' }).click();
    const code = await new Promise<number>((r) => signin.on('exit', (c) => r(c ?? 1)));
    check('login: OAuth with PKCE, consented in the browser, the token saved', code === 0 && /Signed in/.test(signinOut), `${signinOut.trim().split('\n').pop()} · consent named tools:author: ${/tools:author|Build tools/.test(scopes ?? '')}`);
    const who = cli(['whoami', '--server', APP]);
    check('whoami answers as the signed-in person, with the token', who.code === 0 && /admin@local\.dev/.test(who.out) && !/no sign-in/.test(who.out), who.out);

    const pushed = cli(['push', '--server', APP, '--space', HOUSE]);
    const previewUrl = /(http\S+\/tools\/preview\/\S+)/.exec(pushed.out)?.[1];
    check('push makes the working copy and says where to look', pushed.code === 0 && /\(made\)/.test(pushed.out) && !!previewUrl, pushed.out);
    const again = cli(['push', '--server', APP]);
    check('a push with nothing changed writes nothing, to the remembered space', again.code === 0 && /nothing changed/.test(again.out), again.out);

    const inApp = await admin.newPage();
    await inApp.goto(previewUrl!, { waitUntil: 'domcontentloaded' });
    const appFrame = await frameOf(inApp, '/api/tools/runtime/frame');
    await appFrame.getByText('No notes yet').waitFor({ timeout: 45_000 });
    await appFrame.getByPlaceholder('New note').fill('First real note');
    await appFrame.getByRole('button', { name: 'Add' }).click();
    await appFrame.getByText('First real note').waitFor({ timeout: 20_000 });
    const note = await prisma.contextNote.findFirst({ where: { spaceId: HOUSE, path: `${FOLDER}/first-real-note.md`, deletedAt: null }, select: { path: true } });
    check('the preview in the app runs it over the space’s own notes, and writes one', !!note, note?.path ?? 'no note');

    const published = cli(['publish', '--server', APP]);
    const version = await prisma.appToolVersion.findFirst({ where: { key: toolKey(HOUSE, TOOL) }, orderBy: { version: 'desc' }, select: { version: true, status: true, releaseNotes: true } });
    check('publish: an admin’s version is approved, with CHANGELOG’s notes', published.code === 0 && version?.status === 'approved' && !!version.releaseNotes, `${published.out.split('\n').pop()} · ${JSON.stringify(version)}`);

    // ── 4. a deploy key ───────────────────────────────────────────────────────
    step('4. a deploy key pushes and checks one Tool, and nothing else');
    const resolved = await resolveContext({ userId: adminRow.id, name: adminRow.name, email: adminRow.email } as never, HOUSE);
    if (resolved instanceof Response) throw new Error('no admin context');
    const principal = await principalOf(resolved);
    const minted = await mintDeployKey(principal, resolved, TOOL, 'CI');
    if (!minted.ok) throw new Error(minted.error);
    const keyEnv = { VISVINE_TOOL_KEY: minted.key, VISVINE_SPACE: HOUSE, VISVINE_CONFIG_DIR: join(WORK, 'empty-config') };
    rmSync(join(CLONE, '.visvine'), { recursive: true, force: true });
    writeFileSync(join(CLONE, 'src', 'ui.tsx'), `${readFileSync(join(CLONE, 'src', 'ui.tsx'), 'utf8')}\n// from CI\n`);
    const keyPush = cli(['push', '--server', APP], keyEnv);
    check('with only the key and the space, CI pushes the change', keyPush.code === 0 && /ui\.tsx/.test(keyPush.out), keyPush.out);
    const keyCheck = cli(['check', '--remote', '--server', APP], keyEnv);
    check('check --remote: the server builds the package and agrees', keyCheck.code === 0 && /agrees/.test(keyCheck.out), keyCheck.out.split('\n').slice(-2).join(' · '));
    const keyPublish = cli(['publish', '--server', APP], keyEnv);
    const pending = await prisma.appToolVersion.findFirst({ where: { key: toolKey(HOUSE, TOOL) }, orderBy: { version: 'desc' }, select: { version: true, status: true } });
    check('a publish made with a key waits for a space admin — even the admin’s key', keyPublish.code === 0 && pending?.status === 'pending', `${keyPublish.out.split('\n').pop()} · v${pending?.version} ${pending?.status}`);
    const renamed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name: string };
    renamed.name = `${TOOL}-other`;
    writeFileSync(manifestPath, `${JSON.stringify(renamed, null, 2)}\n`);
    const otherTool = cli(['push', '--server', APP], keyEnv);
    manifest.name = TOOL;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    check('another tool is refused', otherTool.code !== 0 && /for the tool vg-starter-board/.test(otherTool.out), otherTool.out);
    const otherAction = cli(['spaces', '--server', APP], keyEnv);
    check('an action outside the key’s reach is refused', otherAction.code !== 0 && /needs you signed in/.test(otherAction.out), otherAction.out);
    const lastUsed = await prisma.appToolDeployKey.findUnique({ where: { id: minted.summary.id }, select: { lastUsedAt: true } });
    check('the key’s last use is recorded', !!lastUsed?.lastUsedAt, String(lastUsed?.lastUsedAt));
    await revokeDeployKey(principal, resolved, TOOL, minted.summary.id);
    const revoked = cli(['push', '--server', APP], keyEnv);
    check('revoked, it is refused', revoked.code !== 0 && /refused the deploy key/.test(revoked.out), revoked.out);

    // ── 5. files ──────────────────────────────────────────────────────────────
    step('5. pack, import elsewhere; init a second Tool');
    const packed = cli(['pack']);
    const file = join(CLONE, `${TOOL}.vvtool`);
    check('pack writes the .vvtool', packed.code === 0 && existsSync(file), packed.out);
    const otherCtx = await resolveContext({ userId: adminRow.id, name: adminRow.name, email: adminRow.email } as never, OTHER);
    if (otherCtx instanceof Response) throw new Error('no other context');
    const imported = await importPackage(await principalOf(otherCtx), otherCtx, readFileSync(file));
    check('another space imports the package and it compiles there', imported.ok && imported.buildOk, imported.ok ? `${imported.name}${imported.renamedFrom ? ` (from ${imported.renamedFrom})` : ''}` : imported.error);
    const init = run('npx', ['--no-install', 'visvine-tool', 'init', join(WORK, 'second')]);
    const second = JSON.parse(readFileSync(join(WORK, 'second', 'visvine-tool.json'), 'utf8')) as { name: string };
    const secondCheck = run('npx', ['--no-install', 'visvine-tool', 'check', '--dir', join(WORK, 'second')]);
    check('init starts a second Tool from the template, and it checks', init.code === 0 && second.name === 'second' && secondCheck.code === 0, `${second.name} · ${secondCheck.out}`);
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
    await browser?.close();
    await cleanup();
    await prisma.$disconnect();
    rmSync(WORK, { recursive: true, force: true });
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
