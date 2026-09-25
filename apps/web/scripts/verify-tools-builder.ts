/**
 * Building a Tool in the app, live: a member with no AI client of their own
 * builds, previews and publishes a working Tool from Build a tool — the M4
 * exit criterion, through every real door.
 *
 *   the More sheet's Build a tool → the builder's stream → the space's model
 *   → create_tool / write_tool / check_tool as the member → the Workbench
 *   follows the new Tool, its preview runs → a Components insert and a save
 *   → Publish, which lands pending for an admin
 *
 * The one thing replaced is the model's judgement. The space's model is a
 * `provider: custom` note pointing at a scripted OpenAI-compatible endpoint
 * this script serves on 127.0.0.1 (dev allows http and private hosts for a
 * custom endpoint), so the app resolves, calls and meters a model exactly as
 * it would a real one, and nothing is spent. What the script asserts is the
 * app: the prompt reached the model with the authoring tools, the calls ran
 * as the member, the files compiled, the page followed, the publish landed.
 *
 * Needs `pnpm dev` with dev auth, Chromium, and a local database — guarded,
 * and everything it adds is taken back out, first and last.
 *
 *   pnpm --filter @visvine/web verify:tools:builder [spaceId]
 */
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import prisma from '../lib/prisma';
import { ADMIN_ALIAS_ID } from '../lib/types/context';
import { LEVEL_EDIT } from '../lib/notes/shared/authz';
import { isAdmin } from '../lib/auth';
import { encryptSecret } from '../lib/crypto/secrets';
import * as store from '../lib/notes/store';
import { toolFolderPath, toolIndexPath } from '../lib/tools/config';
import { toolKey } from '../lib/tools/registry';
import { BUILDER_THREAD } from '../lib/tools/builder';
import { SPACE_ID } from './seed/space';

const SPACE = process.argv[2] ?? SPACE_ID;
const TOOL = 'rsvp-board';
const TITLE = 'RSVP board';
const MODEL_NOTE = 'models/scripted.md';
const MODEL_SECRET = 'MODEL_KEY_CUSTOM';
const APP = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const OWN_NOTES = [`${toolFolderPath(TOOL)}/ui.md`, `${toolFolderPath(TOOL)}/data.md`, toolIndexPath(TOOL)];

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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const shared = (spaceId: string): store.Context => ({ spaceId, ownerKey: store.SHARED_OWNER_KEY });

// ── the scripted model ───────────────────────────────────────────────────────

const INDEX_MD = [
  '---',
  'type: tool',
  `title: "${TITLE}"`,
  'description: "Who is coming to what."',
  'version: 0',
  'surfaces:',
  '  rail: { label: RSVPs, icon: table }',
  '  types: []',
  'perimeter:',
  '  read: ["events/**"]',
  '  write: []',
  '  types: []',
  '  connectors: []',
  '  agents: []',
  '---',
  '',
  'Lists the events in this space.',
  '',
].join('\n');

const UI_TSX = [
  "import { Spinner, Stack, Table, useQuery, useVisvine } from '@visvine/tool-kit'",
  '',
  'export default function RsvpBoard() {',
  '  const visvine = useVisvine()',
  "  const events = useQuery(() => visvine.context.list('events/**'), [])",
  '  if (events.loading) return <Spinner />',
  '  return (',
  '    <Stack gap="md">',
  '      <Table',
  "        columns={[{ key: 'title', header: 'Event', render: (row: { title: string | null; path: string }) => row.title ?? row.path }]}",
  '        rows={events.data ?? []}',
  '        rowKey={(row) => row.path}',
  '      />',
  '    </Stack>',
  '  )',
  '}',
  '',
].join('\n');

interface Seen {
  requests: number;
  toolNames: string[];
  systemHasGuide: boolean;
}

/** What the model "decides" at each step of the turn: one call a step, then the answer. */
function scriptedReply(messages: Array<{ role: string; content?: unknown }>): Record<string, unknown> {
  const lastUser = messages.map((m) => m.role).lastIndexOf('user');
  const toolResults = messages.slice(lastUser + 1).filter((m) => m.role === 'tool').length;
  const call = (name: string, args: Record<string, unknown>) => ({
    role: 'assistant',
    content: null,
    tool_calls: [{ id: `call_${toolResults}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  });
  switch (toolResults) {
    case 0:
      return call('list_context', {});
    case 1:
      return call('create_tool', { name: TOOL, title: TITLE, description: 'Who is coming to what.' });
    case 2:
      return call('write_tool', { name: TOOL, file: 'index.md', content: INDEX_MD });
    case 3:
      return call('write_tool', { name: TOOL, file: 'ui.tsx', content: UI_TSX });
    case 4:
      return call('check_tool', { name: TOOL });
    default:
      return {
        role: 'assistant',
        content: `Built **${TITLE}**: a table of the events in this space. It reads events/** and writes nothing. Try it in the preview.`,
      };
  }
}

function serveModel(seen: Seen): Promise<Server> {
  const server = createServer(async (req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      messages: Array<{ role: string; content?: unknown }>;
      tools?: Array<{ function: { name: string } }>;
    };
    seen.requests++;
    seen.toolNames = (body.tools ?? []).map((t) => t.function.name);
    const system = body.messages.find((m) => m.role === 'system');
    seen.systemHasGuide = typeof system?.content === 'string' && system.content.includes('Building a Visvine Tool');
    const message = scriptedReply(body.messages);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 1000, completion_tokens: 100 } }),
    );
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ── cleanup ──────────────────────────────────────────────────────────────────

async function cleanup(memberId: string | null): Promise<void> {
  const key = toolKey(SPACE, TOOL);
  await prisma.appToolInstall.deleteMany({ where: { key } });
  await prisma.appToolVersion.deleteMany({ where: { key } });
  await prisma.appToolCheckRun.deleteMany({ where: { spaceId: SPACE, name: TOOL } });
  await prisma.contextGrant.deleteMany({ where: { spaceId: SPACE, resourcePath: { startsWith: toolFolderPath(TOOL) } } });
  const context = shared(SPACE);
  for (const path of [...OWN_NOTES, MODEL_NOTE]) await store.deleteNote(context, path);
  await prisma.appToolBuild.deleteMany({ where: { spaceId: SPACE, name: TOOL } });
  await prisma.contextNote.deleteMany({
    where: { spaceId: SPACE, ownerKey: store.SHARED_OWNER_KEY, deletedAt: { not: null }, deletedPath: { in: [...OWN_NOTES, MODEL_NOTE] } },
  });
  await prisma.contextFolder.deleteMany({ where: { spaceId: SPACE, ownerKey: store.SHARED_OWNER_KEY, path: toolFolderPath(TOOL) } });
  await prisma.node.deleteMany({ where: { id: { in: [`tool:${TOOL}`, 'model:scripted'] } } });
  await prisma.connectorSecret.deleteMany({ where: { spaceId: SPACE, name: MODEL_SECRET } });
  if (memberId) await prisma.agentChatThread.deleteMany({ where: { spaceId: SPACE, agentName: BUILDER_THREAD, userId: memberId } });
  await prisma.agentModelUsage.deleteMany({ where: { spaceId: SPACE, name: BUILDER_THREAD } }).catch(() => undefined);
}

async function login(browser: Browser, userId: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${APP}/dev/login`, { waitUntil: 'domcontentloaded' });
  await page.locator(`form[action^="/api/dev/login-as/${userId}"] button`).first().click();
  await page.waitForURL((url) => !url.pathname.startsWith('/dev/login'), { timeout: 30_000 });
  return page;
}

async function main(): Promise<void> {
  const holder = await prisma.userAlias.findFirst({
    where: { spaceId: SPACE, aliasId: ADMIN_ALIAS_ID, user: { email: { endsWith: '@local.dev' } } },
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  const admin = holder?.user;
  if (!admin) throw new Error(`nobody on /dev/login manages ${SPACE}`);
  const rows = await prisma.spaceMember.findMany({
    where: { spaceId: SPACE, status: 'active', userId: { not: admin.id }, user: { email: { endsWith: '@local.dev' } } },
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  let member: { id: string; name: string | null; email: string | null } | null = null;
  for (const row of rows) if (!member && !(await isAdmin(row.user.id, SPACE, row.user.email ?? ''))) member = row.user;
  if (!member) throw new Error(`${SPACE} has no member on /dev/login who is not an admin`);
  console.log(`space   ${SPACE}\nmember  ${member.email}\napp     ${APP}`);

  await cleanup(member.id);
  const seen: Seen = { requests: 0, toolNames: [], systemHasGuide: false };
  const server = await serveModel(seen);
  const port = (server.address() as AddressInfo).port;
  let browser: Browser | null = null;
  let shot: Page | null = null;
  try {
    step('0. the space gets a model: a scripted custom endpoint');
    await store.writeNote(
      shared(SPACE),
      MODEL_NOTE,
      ['---', 'type: model', 'title: "Scripted"', 'provider: custom', `base_url: http://127.0.0.1:${port}/v1`, 'model: scripted', '---', '', 'A scripted model for verify-tools-builder.', ''].join('\n'),
      { id: admin.id, name: admin.name ?? 'admin', email: admin.email },
    );
    await prisma.connectorSecret.create({ data: { spaceId: SPACE, name: MODEL_SECRET, ciphertext: encryptSecret('scripted'), createdBy: admin.email ?? 'admin' } });
    // The seed keeps tools/ to admins; a space that lets members build gives them the folder.
    await prisma.contextGrant.create({
      data: { spaceId: SPACE, subjectType: 'user', subjectId: member.id, resourcePath: toolFolderPath(TOOL), level: LEVEL_EDIT, grantedBy: admin.id },
    });

    browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
    const page = await login(browser, member.id);
    shot = page;

    step('1. Build a tool, from the More sheet');
    await page.goto(`${APP}/s/${encodeURIComponent(SPACE)}/directory`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'More' }).click();
    const buildRow = page.getByRole('link', { name: 'Build a tool' });
    await buildRow.waitFor({ state: 'visible', timeout: 30_000 });
    await buildRow.click();
    await page.waitForURL((url) => url.pathname.endsWith('/tools/build'), { timeout: 30_000 });
    const composer = page.getByRole('textbox', { name: 'Message the builder' });
    const ready = await composer.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true).catch(() => false);
    check('the builder opens, answering on the space\'s model', ready, page.url());
    if (!ready) throw new Error('no composer');

    step('2. one message, and the builder builds');
    await composer.fill('Build an RSVP board: a table of the events in this space.');
    await composer.press('Enter');
    await page.waitForURL((url) => url.pathname.endsWith(`/tools/preview/${TOOL}`), { timeout: 120_000 });
    check('the page follows the new Tool to its Workbench without reloading', true, page.url());
    const answered = await page.getByText(`Built ${TITLE}`, { exact: false }).waitFor({ state: 'visible', timeout: 120_000 }).then(() => true).catch(() => false);
    check('the answer lands in the thread', answered, answered ? 'answer shown' : 'no answer');
    check(
      'the model was handed the authoring tools and the guide, and never publish',
      seen.toolNames.includes('create_tool') && seen.toolNames.includes('write_tool') && !seen.toolNames.includes('publish_tool') && seen.systemHasGuide,
      `${seen.requests} requests · tools [${seen.toolNames.join(', ')}]`,
    );
    const build = await prisma.appToolBuild.findFirst({ where: { spaceId: SPACE, name: TOOL }, select: { ok: true } });
    const index = await store.readNoteOrNull(shared(SPACE), toolIndexPath(TOOL));
    const author = await prisma.contextNote.findFirst({ where: { spaceId: SPACE, path: toolIndexPath(TOOL), deletedAt: null }, select: { createdBy: true } });
    check(
      'the files were written as the member and compile',
      build?.ok === true && !!index?.includes('events/**') && author?.createdBy === member.id,
      `build ${build?.ok} · index ${index ? 'written' : 'missing'} · by ${author?.createdBy}`,
    );
    const thread = await prisma.agentChatThread.findFirst({ where: { spaceId: SPACE, agentName: BUILDER_THREAD, userId: member.id }, select: { id: true } });
    check('the conversation is the member\'s own builder thread', !!thread, thread?.id ?? 'no thread');

    step('3. the preview runs beside it');
    const frame = page.locator(`iframe[title="${TITLE}"]`);
    const running = await frame.waitFor({ state: 'attached', timeout: 60_000 }).then(() => true).catch(() => false);
    check('the working copy runs in the preview', running, running ? 'frame attached' : 'no frame');

    step('4. a component from the kit, inserted and saved');
    const tabs = page.getByRole('tablist', { name: 'Workbench' });
    await tabs.getByRole('tab', { name: 'Components' }).click();
    await page.getByRole('button', { name: /^Banner/ }).click();
    const editor = page.getByRole('textbox', { name: 'ui.tsx' });
    await editor.waitFor({ state: 'visible', timeout: 10_000 });
    const text = await editor.inputValue();
    check(
      "the snippet lands in the builder's ui.tsx with its import merged",
      /import \{[^}]*useQuery[^}]*Banner[^}]*\} from '@visvine\/tool-kit'/.test(text) && text.includes('<Banner') && text.includes("visvine.context.list('events/**')"),
      text.split('\n')[0],
    );
    // No caret was placed, so it went inside the root element and compiles as it stands.
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    let saved: { ok: boolean; uiBundle: string | null } | null = null;
    for (let i = 0; i < 20; i++) {
      saved = await prisma.appToolBuild.findFirst({ where: { spaceId: SPACE, name: TOOL }, select: { ok: true, uiBundle: true } });
      if (saved?.uiBundle?.includes('Two deals have no owner')) break;
      await sleep(500);
    }
    check('the save compiles through the same write as write_tool', saved?.ok === true && !!saved.uiBundle?.includes('Two deals have no owner'), `build ${saved?.ok}`);

    step('5. Publish from the band');
    await page.getByRole('button', { name: 'Publish', exact: true }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true }).click();
    let version = null as { status: string; version: number } | null;
    for (let i = 0; i < 30 && !version; i++) {
      version = await prisma.appToolVersion.findFirst({ where: { key: toolKey(SPACE, TOOL) }, select: { status: true, version: true } });
      if (!version) await sleep(500);
    }
    check("a member's publish waits for an admin", version?.status === 'pending', version ? `v${version.version} ${version.status}` : 'no version');
  } catch (err) {
    fail++;
    console.log(`FAIL  the run stopped\n        ${err instanceof Error ? err.message : String(err)}`);
    if (shot) {
      const file = join(tmpdir(), `verify-tools-builder-${Date.now()}.png`);
      await shot.screenshot({ path: file, fullPage: true }).catch(() => {});
      console.log(`        screenshot: ${file}`);
    }
  } finally {
    await browser?.close().catch(() => {});
    server.close();
    await cleanup(member.id);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

void main();
