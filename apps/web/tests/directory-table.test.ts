// Unit tests for the Directory table's model (lib/directory/table.ts): the
// columns a type has, what a cell reads and how it sorts, a viewer's
// arrangement reconciled with the columns that exist now, and the rules for
// a space extending a type with fields of its own.
// Run: node --import tsx --test tests/directory-table.test.ts
import test, { describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  EMPTY_VIEW,
  addTrackedField,
  applyCellPatch,
  arrangeColumns,
  cellHref,
  cellPatch,
  cellValue,
  coerceTrackedFields,
  coerceView,
  columnsForType,
  compareCells,
  cycleSort,
  fieldKeyFor,
  formatCell,
  isHidden,
  moveColumn,
  parseCellInput,
  placeColumnBefore,
  removeTrackedField,
  sortItems,
  toggleColumn,
  updateTrackedField,
  visibleColumns,
  type TableColumn,
} from '../lib/directory/table'
import type { DirectoryItem, NodeTypeConfig } from '../lib/types'

const person: NodeTypeConfig = { name: 'Person', color: '#2563eb', shape: 'rectangle' }
const personWithFields: NodeTypeConfig = {
  ...person,
  fields: [
    { key: 'deal_stage', label: 'Deal stage', kind: 'select', options: ['Lead', 'Won'] },
    { key: 'net_worth', label: 'Net worth', kind: 'number' },
  ],
}

const item = (over: Partial<DirectoryItem> = {}): DirectoryItem => ({
  id: 'person:craig',
  name: 'Craig',
  type: 'person',
  ...over,
})

const col = (key: string, type = 'person', config: NodeTypeConfig | null = personWithFields): TableColumn => {
  const c = columnsForType(type, config).find((x) => x.key === key)
  assert.ok(c, `no column ${key}`)
  return c
}

describe('columnsForType', () => {
  test('name first, the type rows, then the tracked fields, then alias · tags · added', () => {
    assert.deepEqual(
      columnsForType('person', personWithFields).map((c) => c.key),
      ['name', 'subtitle', 'email', 'companyName', 'linkedinUrl', 'location', 'deal_stage', 'net_worth', 'alias', 'tags', 'created'],
    )
  })

  test('the photo row is not a column', () => {
    assert.ok(!columnsForType('person', person).some((c) => c.key === 'image_url'))
  })

  test('a type with no rows still has the core columns', () => {
    assert.deepEqual(columnsForType('playbook', null).map((c) => c.key), ['name', 'alias', 'tags', 'created'])
  })

  test('a column-backed row keeps its column and its metadata mirror', () => {
    const website = col('url', 'space', null)
    assert.equal(website.source, 'column')
    assert.equal(website.column, 'url')
    assert.equal(website.mirror, 'website')
  })

  test('a stored field colliding with a platform column is dropped, not doubled', () => {
    const config: NodeTypeConfig = { ...person, fields: [{ key: 'email', label: 'Email again', kind: 'text' }] }
    assert.equal(columnsForType('person', config).filter((c) => c.key === 'email').length, 1)
    assert.equal(col('email', 'person', config).origin, 'type')
  })

  test('a select column carries its options', () => {
    assert.deepEqual(col('deal_stage').options, ['Lead', 'Won'])
  })
})

describe('cells', () => {
  test('cellValue reads each source', () => {
    const it = item({
      alias: 'Founder',
      tags: ['ai'],
      subtitle: 'CEO',
      createdAt: '2026-01-02T00:00:00.000Z',
      metadata: { email: 'c@x.com', deal_stage: 'Won' },
    })
    assert.equal(cellValue(it, col('name')), 'Craig')
    assert.equal(cellValue(it, col('alias')), 'Founder')
    assert.deepEqual(cellValue(it, col('tags')), ['ai'])
    assert.equal(cellValue(it, col('subtitle')), 'CEO')
    assert.equal(cellValue(it, col('email')), 'c@x.com')
    assert.equal(cellValue(it, col('deal_stage')), 'Won')
    assert.equal(cellValue(it, col('created')), '2026-01-02T00:00:00.000Z')
    assert.equal(cellValue(item(), col('net_worth')), undefined)
  })

  test('formatCell: blanks are empty, numbers group, links drop their scheme, a bare day stays that day', () => {
    assert.equal(formatCell(undefined, col('net_worth')), '')
    assert.equal(formatCell(null, col('net_worth')), '')
    assert.equal(formatCell(1234567, col('net_worth')), (1234567).toLocaleString())
    assert.equal(formatCell('https://halter.io/', col('linkedinUrl')), 'halter.io')
    assert.equal(formatCell(true, { ...col('net_worth'), kind: 'checkbox' }), 'Yes')
    assert.equal(formatCell(false, { ...col('net_worth'), kind: 'checkbox' }), '')
    assert.equal(formatCell(['a', 'b'], col('tags')), 'a, b')
    // A day rendered in UTC never slips to the day before in a western zone.
    assert.match(formatCell('2026-03-15', col('created')), /15/)
  })

  test('cellHref only links what looks like a link', () => {
    assert.equal(cellHref('halter.io', col('linkedinUrl')), 'https://halter.io')
    assert.equal(cellHref('https://halter.io/x', col('linkedinUrl')), 'https://halter.io/x')
    assert.equal(cellHref('not a link', col('linkedinUrl')), null)
    assert.equal(cellHref('c@x.com', col('email')), 'mailto:c@x.com')
    assert.equal(cellHref('nope', col('email')), null)
    assert.equal(cellHref('halter.io', col('subtitle')), null)
  })

  test('compareCells: numeric for numbers, chronological for dates, blanks last', () => {
    const n = col('net_worth')
    assert.ok(compareCells(9, 10, n) < 0)
    assert.ok(compareCells('9', '10', n) < 0)
    assert.ok(compareCells(undefined, 1, n) > 0)
    assert.ok(compareCells(1, null, n) < 0)
    const d = col('created')
    assert.ok(compareCells('2026-01-01', '2025-12-31', d) > 0)
    const t = col('subtitle')
    assert.ok(compareCells('item 2', 'item 10', t) < 0, 'natural order')
  })

  test('sortItems keeps blanks last in either direction and is stable', () => {
    const rows = [
      item({ id: 'a', name: 'A', metadata: { net_worth: 5 } }),
      item({ id: 'b', name: 'B' }),
      item({ id: 'c', name: 'C', metadata: { net_worth: 1 } }),
      item({ id: 'd', name: 'D', metadata: { net_worth: 5 } }),
    ]
    const columns = columnsForType('person', personWithFields)
    assert.deepEqual(sortItems(rows, columns, { key: 'net_worth', dir: 'asc' }).map((r) => r.id), ['c', 'a', 'd', 'b'])
    assert.deepEqual(sortItems(rows, columns, { key: 'net_worth', dir: 'desc' }).map((r) => r.id), ['a', 'd', 'c', 'b'])
    assert.deepEqual(sortItems(rows, columns, null).map((r) => r.id), ['a', 'b', 'c', 'd'])
    assert.deepEqual(sortItems(rows, columns, { key: 'nope', dir: 'asc' }).map((r) => r.id), ['a', 'b', 'c', 'd'])
  })

  test('cycleSort goes asc → desc → off', () => {
    const asc = cycleSort(null, 'name')
    assert.deepEqual(asc, { key: 'name', dir: 'asc' })
    const desc = cycleSort(asc, 'name')
    assert.deepEqual(desc, { key: 'name', dir: 'desc' })
    assert.equal(cycleSort(desc, 'name'), null)
    assert.deepEqual(cycleSort(desc, 'email'), { key: 'email', dir: 'asc' })
  })
})

describe('the viewer\'s arrangement', () => {
  const columns = columnsForType('person', personWithFields)

  test('an empty view is the canonical order with Added hidden', () => {
    assert.deepEqual(visibleColumns(EMPTY_VIEW, columns).map((c) => c.key), columns.map((c) => c.key).filter((k) => k !== 'created'))
  })

  test('a column the view never met appears at its canonical place', () => {
    const view = { ...EMPTY_VIEW, order: ['name', 'location', 'subtitle', 'alias', 'tags', 'created'] }
    const keys = arrangeColumns(view, columns).map((c) => c.key)
    assert.deepEqual(keys, ['name', 'location', 'subtitle', 'email', 'companyName', 'linkedinUrl', 'deal_stage', 'net_worth', 'alias', 'tags', 'created'])
  })

  test('a key the view names that no longer exists is ignored', () => {
    const view = { ...EMPTY_VIEW, order: ['gone', 'name'], hidden: ['gone'] }
    assert.equal(arrangeColumns(view, columns)[0].key, 'name')
  })

  test('toggle hides and shows, and showing Added records that it was met', () => {
    assert.equal(isHidden(EMPTY_VIEW, 'created'), true)
    const shown = toggleColumn(EMPTY_VIEW, columns, 'created')
    assert.equal(isHidden(shown, 'created'), false)
    assert.ok(shown.order.includes('created'))
    const hidden = toggleColumn(shown, columns, 'email')
    assert.ok(!visibleColumns(hidden, columns).some((c) => c.key === 'email'))
    assert.ok(visibleColumns(toggleColumn(hidden, columns, 'email'), columns).some((c) => c.key === 'email'))
  })

  test('move and placeBefore reorder in the full order, hidden columns included', () => {
    const moved = moveColumn(EMPTY_VIEW, columns, 'email', -1)
    assert.deepEqual(moved.order.slice(0, 3), ['name', 'email', 'subtitle'])
    assert.equal(moveColumn(EMPTY_VIEW, columns, 'name', -1), EMPTY_VIEW, 'cannot move off the start')
    const placed = placeColumnBefore(EMPTY_VIEW, columns, 'created', 'name')
    assert.equal(placed.order[0], 'created')
    const end = placeColumnBefore(EMPTY_VIEW, columns, 'name', null)
    assert.equal(end.order[end.order.length - 1], 'name')
    assert.equal(placeColumnBefore(EMPTY_VIEW, columns, 'name', 'name'), EMPTY_VIEW)
  })

  test('coerceView survives anything a previous version stored', () => {
    assert.deepEqual(coerceView(null), EMPTY_VIEW)
    assert.deepEqual(coerceView('junk'), EMPTY_VIEW)
    assert.deepEqual(coerceView({ order: ['a', 1], hidden: 'x', sort: { key: 'a', dir: 'sideways' }, widths: { a: 100, b: 'wide' } }), {
      order: ['a'],
      hidden: [],
      sort: { key: 'a', dir: 'asc' },
      widths: { a: 100 },
    })
  })
})

describe('editing', () => {
  test('parseCellInput types the value by column kind', () => {
    assert.deepEqual(parseCellInput(' 1,200 ', col('net_worth')), { ok: true, value: 1200 })
    assert.equal(parseCellInput('lots', col('net_worth')).ok, false)
    assert.deepEqual(parseCellInput('Won', col('deal_stage')), { ok: true, value: 'Won' })
    assert.equal(parseCellInput('Lost', col('deal_stage')).ok, false)
    assert.deepEqual(parseCellInput('a, B, a', col('tags')), { ok: true, value: ['a', 'B'] })
    assert.deepEqual(parseCellInput('', col('tags')), { ok: true, value: [] })
    assert.deepEqual(parseCellInput('', col('email')), { ok: true, value: null })
    assert.equal(parseCellInput('nope', col('email')).ok, false)
    assert.equal(parseCellInput('', col('name')).ok, false)
    assert.deepEqual(parseCellInput('2026-03-15', { ...col('net_worth'), kind: 'date' }), { ok: true, value: '2026-03-15' })
    assert.equal(parseCellInput('15/03/2026', { ...col('net_worth'), kind: 'date' }).ok, false)
    assert.deepEqual(parseCellInput('yes', { ...col('net_worth'), kind: 'checkbox' }), { ok: true, value: true })
  })

  test('cellPatch routes each source to the PATCH body', () => {
    assert.deepEqual(cellPatch(col('name'), 'Craig W'), { name: 'Craig W' })
    assert.deepEqual(cellPatch(col('tags'), ['a']), { tags: ['a'] })
    assert.deepEqual(cellPatch(col('subtitle'), 'CEO'), { subtitle: 'CEO' })
    assert.deepEqual(cellPatch(col('subtitle'), null), { subtitle: '' })
    assert.deepEqual(cellPatch(col('url', 'space', null), 'halter.io'), { url: 'halter.io', metadata: { website: 'halter.io' } })
    assert.deepEqual(cellPatch(col('url', 'space', null), null), { url: '', metadata: { website: null } })
    assert.deepEqual(cellPatch(col('net_worth'), 5), { metadata: { net_worth: 5 } })
    assert.deepEqual(cellPatch(col('net_worth'), null), { metadata: { net_worth: null } })
    assert.equal(cellPatch(col('alias'), 'x'), null)
    assert.equal(cellPatch(col('created'), 'x'), null)
  })

  test('applyCellPatch is the row as it will read', () => {
    const it = item({ subtitle: 'CEO', metadata: { email: 'c@x.com' } })
    const next = applyCellPatch(applyCellPatch(it, { subtitle: '' }), { metadata: { net_worth: 5 } })
    assert.equal(next.subtitle, null)
    assert.deepEqual(next.metadata, { email: 'c@x.com', net_worth: 5 })
    assert.equal(it.subtitle, 'CEO', 'the input is untouched')
  })
})

describe('tracked fields', () => {
  test('fieldKeyFor mints a metadata key from a label', () => {
    assert.equal(fieldKeyFor('Deal stage'), 'deal_stage')
    assert.equal(fieldKeyFor('  Net-Worth ($)  '), 'net_worth')
    assert.equal(fieldKeyFor('2026 target'), 'f_2026_target')
    assert.equal(fieldKeyFor('$$$'), 'field')
  })

  test('addTrackedField appends a field and leaves the input untouched', () => {
    const r = addTrackedField(person, { label: 'Deal stage', kind: 'select', options: ['Lead', ' Won ', 'won', ''] })
    assert.ok(r.ok)
    assert.deepEqual(r.field, { key: 'deal_stage', label: 'Deal stage', kind: 'select', options: ['Lead', 'Won'] })
    assert.deepEqual(r.config.fields, [r.field])
    assert.equal(person.fields, undefined)
  })

  test('addTrackedField refuses what would collide or is not a field', () => {
    const errors = [
      addTrackedField(person, { label: '', kind: 'text' }),
      addTrackedField(person, { label: 'Email', kind: 'text' }),
      addTrackedField(person, { label: 'location', kind: 'text' }),
      addTrackedField(person, { label: 'Tags', kind: 'text' }),
      addTrackedField(person, { label: 'User id', kind: 'text' }),
      addTrackedField(person, { label: 'Status', kind: 'text' }),
      addTrackedField(personWithFields, { label: 'deal stage', kind: 'text' }),
      addTrackedField(person, { label: 'Stage', kind: 'select', options: [' '] }),
      addTrackedField(person, { label: 'x'.repeat(41), kind: 'text' }),
      addTrackedField(person, { label: 'Odd', kind: 'blob' as never }),
    ]
    for (const r of errors) assert.equal(r.ok, false)
  })

  test('options are dropped for a kind that has none', () => {
    const r = addTrackedField(person, { label: 'Notes', kind: 'text', options: ['a'] })
    assert.ok(r.ok && r.field.options === undefined)
  })

  test('removeTrackedField drops the field and the key when none remain', () => {
    const one = removeTrackedField(personWithFields, 'deal_stage')
    assert.deepEqual(one.fields?.map((f) => f.key), ['net_worth'])
    const none = removeTrackedField(one, 'net_worth')
    assert.equal('fields' in none, false)
    assert.equal(removeTrackedField(person, 'nope').fields, undefined)
  })

  test('updateTrackedField renames or re-options but never re-keys', () => {
    const r = updateTrackedField(personWithFields, 'deal_stage', { label: 'Stage', options: ['Lead', 'Won', 'Lost'] })
    assert.ok(r.ok)
    assert.deepEqual(r.field, { key: 'deal_stage', label: 'Stage', kind: 'select', options: ['Lead', 'Won', 'Lost'] })
    assert.equal(updateTrackedField(personWithFields, 'deal_stage', { label: 'Net worth' }).ok, false, 'label clash')
    assert.equal(updateTrackedField(personWithFields, 'nope', { label: 'x' }).ok, false)
    const numberField = updateTrackedField(personWithFields, 'net_worth', { options: ['a'] })
    assert.ok(numberField.ok && numberField.field.options === undefined)
  })

  test('coerceTrackedFields validates a hand-edited config note', () => {
    assert.deepEqual(coerceTrackedFields(personWithFields.fields), personWithFields.fields)
    assert.ok('error' in coerceTrackedFields('x'))
    assert.ok('error' in coerceTrackedFields([{ key: 'Bad Key', label: 'x', kind: 'text' }]))
    assert.ok('error' in coerceTrackedFields([{ key: 'a', label: '', kind: 'text' }]))
    assert.ok('error' in coerceTrackedFields([{ key: 'a', label: 'A', kind: 'blob' }]))
    assert.ok('error' in coerceTrackedFields([{ key: 'a', label: 'A', kind: 'select' }]))
    assert.ok('error' in coerceTrackedFields([{ key: 'a', label: 'A', kind: 'text' }, { key: 'a', label: 'B', kind: 'text' }]))
  })
})
