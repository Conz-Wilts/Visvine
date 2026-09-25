/**
 * The records layer's rules (lib/records/shared/fields.ts, and the reserved
 * keys in lib/directory/table.ts): how an invented type's frontmatter reads as
 * its fields, what a field write may change, what a query means, and which
 * vocabulary changes re-read a type's notes (lib/records/projection.ts).
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/records.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { addTrackedField, columnsForType } from '@/lib/directory/table'
import {
  cellValueOf,
  checkQuery,
  compareRows,
  decodeRecordCursor,
  encodeRecordCursor,
  matchesPredicate,
  noteFieldDenial,
  noteTypeFor,
  planNoteFieldWrite,
  projectFieldValue,
  recordColumns,
  type RecordRow,
} from '@/lib/records/shared/fields'
import { changedNoteTypes } from '@/lib/records/projection'
import type { NodeTypeConfig } from '@/lib/types'

const DEAL: NodeTypeConfig = {
  name: 'Deal',
  color: '#000000',
  shape: 'circle',
  scope: 'note',
  fields: [
    { key: 'stage', label: 'Stage', kind: 'select', options: ['Lead', 'Won', 'Lost'] },
    { key: 'amount', label: 'Amount', kind: 'number' },
    { key: 'close_date', label: 'Close date', kind: 'date' },
    { key: 'signed', label: 'Signed', kind: 'checkbox' },
    { key: 'site', label: 'Site', kind: 'url' },
    { key: 'owner_email', label: 'Owner email', kind: 'email' },
    { key: 'notes_line', label: 'Notes line', kind: 'text' },
  ],
} as NodeTypeConfig

const column = (key: string) => recordColumns(DEAL).find((c) => c.key === key)!

// ── fields ───────────────────────────────────────────────────────────────────

test("a note type's field keys are the frontmatter keys no note already means something by", () => {
  for (const reserved of ['status', 'title', 'tags', 'type', 'share', 'expires', 'supersedes']) {
    assert.ok(noteFieldDenial(reserved), reserved)
    const added = addTrackedField(DEAL, { label: reserved, kind: 'text' })
    assert.equal(added.ok, false, `${reserved} was accepted as a field`)
  }
  // Spelled differently is still the key.
  assert.equal(addTrackedField(DEAL, { label: 'Share As', kind: 'text' }).ok, false)
  assert.equal(addTrackedField(DEAL, { label: 'Probability', kind: 'number' }).ok, true)
})

test("an invented type's columns are its fields; a stored field named after a reserved key is not one", () => {
  assert.deepEqual(recordColumns(DEAL).map((c) => c.key), DEAL.fields!.map((f) => f.key))
  const stale = { ...DEAL, fields: [...DEAL.fields!, { key: 'share', label: 'Share', kind: 'text' as const }] }
  assert.equal(recordColumns(stale).some((c) => c.key === 'share'), false)
  assert.ok(columnsForType('Deal', DEAL).some((c) => c.key === 'stage' && c.origin === 'tracked'))
})

test('noteTypeFor names only the space\'s invented types', () => {
  const types = [DEAL, { name: 'Person', color: '#000000', shape: 'circle' } as NodeTypeConfig]
  assert.equal(noteTypeFor('deal', types)?.name, 'Deal')
  assert.equal(noteTypeFor('Person', types), null)
  assert.equal(noteTypeFor(undefined, types), null)
  assert.equal(noteTypeFor(['Deal'], types), null)
})

// ── projection ───────────────────────────────────────────────────────────────

test('a frontmatter value reads as its kind, or is kept as invalid with what was written', () => {
  assert.deepEqual(projectFieldValue(column('amount'), 12000), { textValue: null, numberValue: 12000, dateValue: null, boolValue: null, raw: null, invalid: false })
  assert.equal(projectFieldValue(column('amount'), '12,500')?.numberValue, 12500)
  assert.deepEqual(projectFieldValue(column('amount'), 'a lot'), { textValue: null, numberValue: null, dateValue: null, boolValue: null, raw: 'a lot', invalid: true })
  assert.equal(projectFieldValue(column('stage'), 'Won')?.textValue, 'Won')
  assert.equal(projectFieldValue(column('stage'), 'Maybe')?.invalid, true)
  assert.equal(projectFieldValue(column('close_date'), '2026-10-01')?.dateValue?.toISOString(), '2026-10-01T00:00:00.000Z')
  assert.equal(projectFieldValue(column('close_date'), 'next week')?.invalid, true)
  // YAML may hand a date over as a Date.
  assert.equal(projectFieldValue(column('close_date'), new Date('2026-10-02T00:00:00Z'))?.textValue, '2026-10-02')
  assert.equal(projectFieldValue(column('signed'), true)?.boolValue, true)
  assert.equal(projectFieldValue(column('owner_email'), 'not-an-email')?.invalid, true)
  // A list is no cell's value; nothing written is no row at all.
  assert.equal(projectFieldValue(column('notes_line'), ['a', 'b'])?.invalid, true)
  assert.equal(projectFieldValue(column('notes_line'), '   '), null)
  assert.equal(projectFieldValue(column('notes_line'), undefined), null)
})

test('a projected value reads back as the cell shows it', () => {
  assert.equal(cellValueOf(projectFieldValue(column('amount'), 7)!), 7)
  assert.equal(cellValueOf(projectFieldValue(column('close_date'), '2026-01-31')!), '2026-01-31')
  assert.equal(cellValueOf(projectFieldValue(column('amount'), 'lots')!), 'lots')
})

test('re-reading a type follows its fields, and a type that comes or goes', () => {
  const plain = { name: 'Person', color: '#000', shape: 'circle' } as NodeTypeConfig
  assert.deepEqual(changedNoteTypes([DEAL, plain], [DEAL, plain]), [])
  const renamedField = { ...DEAL, fields: DEAL.fields!.map((f) => (f.key === 'stage' ? { ...f, label: 'Phase' } : f)) }
  assert.deepEqual(changedNoteTypes([DEAL], [renamedField]), [], 'a relabel changes no value')
  const newOption = { ...DEAL, fields: DEAL.fields!.map((f) => (f.key === 'stage' ? { ...f, options: [...f.options!, 'Paused'] } : f)) }
  assert.deepEqual(changedNoteTypes([DEAL], [newOption]), ['Deal'])
  assert.deepEqual(changedNoteTypes([], [DEAL]), ['Deal'])
  assert.deepEqual(changedNoteTypes([DEAL], []), ['Deal'])
  // A node-backed type's fields live on nodes; nothing to re-read.
  assert.deepEqual(changedNoteTypes([plain], [{ ...plain, fields: [{ key: 'x', label: 'X', kind: 'text' }] }]), [])
})

// ── writes ───────────────────────────────────────────────────────────────────

test('a field write sets declared fields, parsed, clears on blank, and refuses the rest', () => {
  assert.deepEqual(planNoteFieldWrite(DEAL, { stage: 'Won', amount: '12,000', signed: 'yes', site: '' }), {
    ok: true,
    set: { stage: 'Won', amount: 12000, signed: true },
    clear: ['site'],
  })
  const reserved = planNoteFieldWrite(DEAL, { status: 'rejected' })
  assert.equal(reserved.ok, false)
  assert.match(reserved.ok ? '' : reserved.error, /kept by the platform/)
  assert.match(planNoteFieldWrite(DEAL, { colour: 'red' }).ok ? '' : 'refused', /refused/)
  const bad = planNoteFieldWrite(DEAL, { stage: 'Maybe' })
  assert.equal(bad.ok, false)
  assert.match(bad.ok ? '' : bad.error, /options/i)
})

// ── queries ──────────────────────────────────────────────────────────────────

test('predicates: equals ignores case, in, range over numbers and dates, contains', () => {
  const amount = projectFieldValue(column('amount'), 12000)!
  const stage = projectFieldValue(column('stage'), 'Won')!
  const date = projectFieldValue(column('close_date'), '2026-10-01')!
  assert.equal(matchesPredicate(stage, { key: 'stage', op: 'eq', value: 'won' }), true)
  assert.equal(matchesPredicate(stage, { key: 'stage', op: 'in', values: ['Lead', 'Won'] }), true)
  assert.equal(matchesPredicate(amount, { key: 'amount', op: 'range', min: 10000, max: 20000 }), true)
  assert.equal(matchesPredicate(amount, { key: 'amount', op: 'range', min: 13000 }), false)
  assert.equal(matchesPredicate(date, { key: 'close_date', op: 'range', min: '2026-09-01', max: '2026-12-31' }), true)
  assert.equal(matchesPredicate(date, { key: 'close_date', op: 'range', max: '2026-09-30' }), false)
  assert.equal(matchesPredicate(projectFieldValue(column('notes_line'), 'Renewal call')!, { key: 'notes_line', op: 'contains', value: 'renewal' }), true)
  // Absent and invalid never match.
  assert.equal(matchesPredicate(undefined, { key: 'stage', op: 'eq', value: 'Won' }), false)
  assert.equal(matchesPredicate(projectFieldValue(column('amount'), 'lots')!, { key: 'amount', op: 'range', min: 0 }), false)
})

test('ordering puts empty last and ties break by path; a cursor is an offset', () => {
  const row = (path: string, amount: unknown): RecordRow => ({ path, type: 'Deal', title: path, tags: [], updatedAt: '', fields: amount === undefined ? {} : { amount }, invalid: [] })
  const rows = [row('c', 5), row('a', undefined), row('b', 20), row('d', 5)]
  assert.deepEqual([...rows].sort(compareRows({ key: 'amount', direction: 'desc' })).map((r) => r.path), ['b', 'c', 'd', 'a'])
  assert.deepEqual([...rows].sort(compareRows({ key: 'amount', direction: 'asc' })).map((r) => r.path), ['c', 'd', 'b', 'a'])
  assert.equal(decodeRecordCursor(encodeRecordCursor(40)), 40)
  assert.equal(decodeRecordCursor('not-a-cursor'), 0)
  assert.equal(decodeRecordCursor(null), 0)
})

test('a query names only fields the type has', () => {
  assert.equal(checkQuery(DEAL, { type: 'Deal', where: [{ key: 'stage', op: 'eq', value: 'Won' }], order: { key: 'amount', direction: 'asc' } }), null)
  assert.match(checkQuery(DEAL, { type: 'Deal', where: [{ key: 'colour', op: 'eq', value: 'red' }] }) ?? '', /not a field/)
  assert.equal(checkQuery(DEAL, { type: 'Deal', order: { key: 'updated', direction: 'desc' } }), null)
})
