/**
 * The records layer, live — M5's exit criteria through the real doors:
 *
 *   an invented type gets fields (and a `Status` field is refused as reserved)
 *   → its notes are projected, a bad value flagged invalid → a filtered,
 *   ordered query over them → an agent sets a record's stage through
 *   `set_fields` and a reserved key is refused → adding a field re-reads the
 *   type's notes → the Directory's table lists the type, and a cell edit lands
 *   in the note's frontmatter.
 *
 * Uses its own type (`Opportunity`) and notes under `verify-records/`, and takes
 * all of it back out, first and last. Needs `pnpm dev` with dev auth and
 * Chromium for the table step; the rest runs in-process against the local
 * database (guarded).
 *
 *   pnpm --filter @visvine/web verify:records [spaceId]
 */
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import prisma from '../lib/prisma';
import { ADMIN_ALIAS_ID } from '../lib/types/context';
import * as store from '../lib/notes/store';
import { runAction } from '../lib/actions/run';
import { ActionError, type ActionCaller } from '../lib/actions/types';
import { updateSpaceConfig } from '../lib/spaces/spaceConfig';
import { addTrackedField } from '../lib/directory/table';
import type { NodeTypeConfig } from '../lib/types';
import { SPACE_ID } from './seed/space';

const SPACE = process.argv[2] ?? SPACE_ID;
const TYPE = 'Opportunity';
const FOLDER = 'verify-records';
const NOTES = {
  acme: `${FOLDER}/acme.md`,
  globex: `${FOLDER}/globex.md`,
  initech: `${FOLDER}/initech.md`,
};
const APP = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

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
const shared: store.Context = { spaceId: SPACE, ownerKey: store.SHARED_OWNER_KEY };

function note(title: string, fields: Record<string, string | number>): string {
  return ['---', `type: ${TYPE}`, `title: "${title}"`, ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), '---', '', `${title}.`, ''].join('\n');
}

async function withoutType(): Promise<void> {
  await updateSpaceConfig(SPACE, (stored) => ({
    nodeTypes: (stored.nodeTypes ?? []).filter((t) => t.name !== TYPE),
  }));
}

async function cleanup(): Promise<void> {
  for (const path of [...Object.values(NOTES), `${FOLDER}/index.md`]) await store.deleteNote(shared, path);
  await prisma.contextNote.deleteMany({ where: { spaceId: SPACE, deletedAt: { not: null }, deletedPath: { startsWith: `${FOLDER}/` } } });
  await prisma.contextFolder.deleteMany({ where: { spaceId: SPACE, path: FOLDER } });
  await withoutType();
  await prisma.contextRecordField.deleteMany({ where: { spaceId: SPACE, type: TYPE } });
  await prisma.contextRecord.deleteMany({ where: { spaceId: SPACE, type: TYPE } });
}

async function outcome(run: () => Promise<unknown>): Promise<{ ok: true; value: unknown } | { ok: false; status: number; message: string }> {
  try {
    return { ok: true, value: await run() };
  } catch (e) {
    if (e instanceof ActionError) return { ok: false, status: e.status, message: e.message };
    throw e;
  }
}

async function main(): Promise<void> {
  const holder = await prisma.userAlias.findFirst({
    where: { spaceId: SPACE, aliasId: ADMIN_ALIAS_ID, user: { email: { endsWith: '@local.dev' } } },
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  const admin = holder?.user;
  if (!admin) throw new Error(`nobody on /dev/login manages ${SPACE}`);
  const person: ActionCaller = { userId: admin.id, name: admin.name ?? '', email: admin.email ?? '', scopes: ['context:read', 'context:write'], via: 'api' };
  // An agent run's own caller: the same person's reach, stamped as the agent.
  const agent: ActionCaller = { ...person, via: 'agent', agentName: 'deal-desk' };
  const actor = { id: admin.id, name: admin.name ?? 'admin', email: admin.email };
  console.log(`space   ${SPACE}\nadmin   ${admin.email}`);

  await cleanup();
  let browser: Browser | null = null;
  let shot: Page | null = null;
  try {
    step('1. an invented type gets fields');
    await runAction(person, 'add_type', { space_id: SPACE, name: TYPE });
    let refusedStatus = '';
    await updateSpaceConfig(SPACE, (stored) => ({
      nodeTypes: (stored.nodeTypes ?? []).map((t): NodeTypeConfig => {
        if (t.name !== TYPE) return t;
        let next = t;
        for (const field of [
          { label: 'Stage', kind: 'select' as const, options: ['Lead', 'Won', 'Lost'] },
          { label: 'Amount', kind: 'number' as const },
          { label: 'Close date', kind: 'date' as const },
        ]) {
          const added = addTrackedField(next, field);
          if (added.ok) next = added.config;
        }
        const status = addTrackedField(next, { label: 'Status', kind: 'text' });
        refusedStatus = status.ok ? 'ACCEPTED' : status.error;
        return next;
      }),
    }));
    const stored = (await prisma.space.findUnique({ where: { id: SPACE }, select: { nodeTypes: true } }))?.nodeTypes as unknown as NodeTypeConfig[];
    const type = stored.find((t) => t.name === TYPE);
    check(
      'the type is the space\'s own, with Stage, Amount and Close date',
      type?.scope === 'note' && JSON.stringify(type.fields?.map((f) => f.key)) === JSON.stringify(['stage', 'amount', 'close_date']),
      JSON.stringify(type?.fields?.map((f) => f.key)),
    );
    check('a Status field is refused as reserved', refusedStatus !== 'ACCEPTED' && /already/.test(refusedStatus), refusedStatus);

    step('2. its notes are its records');
    await store.writeNote(shared, NOTES.acme, note('Acme', { stage: 'Lead', amount: 12000, probability: 60 }), actor);
    await store.writeNote(shared, NOTES.globex, note('Globex', { stage: 'Lead', amount: 'lots' }), actor);
    await store.writeNote(shared, NOTES.initech, note('Initech', { stage: 'Won', amount: 5000, close_date: '2026-10-01' }), actor);
    const records = await prisma.contextRecord.count({ where: { spaceId: SPACE, type: TYPE } });
    const invalid = await prisma.contextRecordField.findFirst({ where: { spaceId: SPACE, path: NOTES.globex, key: 'amount' }, select: { invalid: true, raw: true } });
    check('three notes, three records', records === 3, `${records} records`);
    check('a value that is not its kind is kept, flagged invalid', invalid?.invalid === true && invalid.raw === 'lots', JSON.stringify(invalid));

    step('3. a filtered, ordered query');
    const leads = (await runAction(person, 'list_records', { space_id: SPACE, type: TYPE, where: [{ key: 'stage', op: 'eq', value: 'lead' }] })).result as {
      records: Array<{ title: string }>;
    };
    check('stage = Lead finds Acme and Globex', JSON.stringify(leads.records.map((r) => r.title).sort()) === '["Acme","Globex"]', leads.records.map((r) => r.title).join(', '));
    const big = (await runAction(person, 'list_records', {
      space_id: SPACE,
      type: TYPE,
      where: [{ key: 'amount', op: 'range', min: 1000 }],
      order_by: 'amount',
      direction: 'desc',
    })).result as { records: Array<{ title: string }> };
    check(
      'amount ≥ 1000, largest first — the invalid one never matches',
      JSON.stringify(big.records.map((r) => r.title)) === '["Acme","Initech"]',
      big.records.map((r) => r.title).join(', '),
    );
    const typesAnswer = (await runAction(person, 'list_records', { space_id: SPACE })).result as { types: Array<{ name: string; count: number }> };
    check('without a type, the space\'s own types and their counts', typesAnswer.types.some((t) => t.name === TYPE && t.count === 3), JSON.stringify(typesAnswer.types));

    step("4. an agent sets a deal's stage through set_fields");
    const set = await outcome(() => runAction(agent, 'set_fields', { space_id: SPACE, path: NOTES.globex, fields: { stage: 'Won', amount: '8,500' } }));
    const globex = await store.readNoteOrNull(shared, NOTES.globex);
    const author = await prisma.contextNoteRevision.findFirst({
      where: { note: { spaceId: SPACE, path: NOTES.globex } },
      orderBy: { at: 'desc' },
      select: { origin: true },
    }).catch(() => null);
    check(
      'the stage and amount land in the note, parsed',
      set.ok && !!globex?.includes('stage: Won') && !!globex.includes('amount: 8500'),
      set.ok ? (globex ?? '').split('\n').slice(0, 6).join(' | ') : `${set.status}: ${set.message}`,
    );
    const won = (await runAction(person, 'list_records', { space_id: SPACE, type: TYPE, where: [{ key: 'stage', op: 'eq', value: 'Won' }] })).result as { records: Array<{ title: string }> };
    check('the projection follows the write', JSON.stringify(won.records.map((r) => r.title).sort()) === '["Globex","Initech"]', `${won.records.map((r) => r.title).join(', ')} · revision ${author?.origin ?? '—'}`);
    const reserved = await outcome(() => runAction(agent, 'set_fields', { space_id: SPACE, path: NOTES.acme, fields: { status: 'rejected' } }));
    check('a reserved key is refused', !reserved.ok && reserved.status === 400 && /kept by the platform/.test(reserved.message), reserved.ok ? 'WRITTEN' : reserved.message);
    const undeclared = await outcome(() => runAction(agent, 'set_fields', { space_id: SPACE, path: NOTES.acme, fields: { colour: 'red' } }));
    check('a key the type does not declare is refused', !undeclared.ok && /not a field/.test(undeclared.message), undeclared.ok ? 'WRITTEN' : undeclared.message);
    const badOption = await outcome(() => runAction(agent, 'set_fields', { space_id: SPACE, path: NOTES.acme, fields: { stage: 'Maybe' } }));
    check('a value its kind refuses is refused', !badOption.ok && /option/i.test(badOption.message), badOption.ok ? 'WRITTEN' : badOption.message);

    step('5. a new field re-reads the notes that already say it');
    await updateSpaceConfig(SPACE, (storedConfig) => ({
      nodeTypes: (storedConfig.nodeTypes ?? []).map((t) => {
        if (t.name !== TYPE) return t;
        const added = addTrackedField(t, { label: 'Probability', kind: 'number' });
        return added.ok ? added.config : t;
      }),
    }));
    const probability = await prisma.contextRecordField.findFirst({ where: { spaceId: SPACE, path: NOTES.acme, key: 'probability' }, select: { numberValue: true } });
    check('Acme\'s probability: 60 is now a field value — no note was written', probability?.numberValue === 60, JSON.stringify(probability));

    step('6. the Directory lists the type, and a cell edits the note');
    browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    shot = page;
    await page.goto(`${APP}/dev/login`, { waitUntil: 'domcontentloaded' });
    await page.locator(`form[action^="/api/dev/login-as/${admin.id}"] button`).first().click();
    await page.waitForURL((url) => !url.pathname.startsWith('/dev/login'), { timeout: 30_000 });
    await page.goto(`${APP}/s/${encodeURIComponent(SPACE)}/directory?view=table&type=${TYPE.toLowerCase()}`, { waitUntil: 'domcontentloaded' });
    const acmeRow = page.getByRole('row').filter({ hasText: 'Acme' });
    const listed = await acmeRow.first().waitFor({ state: 'visible', timeout: 60_000 }).then(() => true).catch(() => false);
    const headers = listed ? (await page.getByRole('columnheader').allInnerTexts()).map((t) => t.trim()) : [];
    check(
      'the table lists the records with their fields as columns',
      listed && headers.some((h) => h.startsWith('Stage')) && headers.some((h) => h.startsWith('Amount')),
      headers.join(' · '),
    );
    await page.screenshot({ path: join(tmpdir(), 'verify-records-table.png') });
    // Stage is a select: pressing the cell opens it, choosing commits.
    await acmeRow.first().getByRole('button', { name: /Lead/ }).first().click();
    await acmeRow.first().locator('select').selectOption('Lost');
    let acme = '';
    for (let i = 0; i < 20 && !acme.includes('stage: Lost'); i++) {
      acme = (await store.readNoteOrNull(shared, NOTES.acme)) ?? '';
      if (!acme.includes('stage: Lost')) await sleep(500);
    }
    check('a Stage cell edit lands in the note\'s frontmatter', acme.includes('stage: Lost'), acme.split('\n').slice(0, 6).join(' | '));
  } catch (err) {
    fail++;
    console.log(`FAIL  the run stopped\n        ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    if (shot) {
      const file = join(tmpdir(), `verify-records-${Date.now()}.png`);
      await shot.screenshot({ path: file, fullPage: true }).catch(() => {});
      console.log(`        screenshot: ${file}`);
    }
  } finally {
    await browser?.close().catch(() => {});
    await cleanup();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

void main();
