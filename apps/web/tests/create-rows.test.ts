// The Create panel's list and its routing table, kept honest: every kind
// resolves to a flow, "New type" leads the unsearched list, the page you are
// on ranks its kinds first, a search finds a type by its synonym, and a named
// "New type" row appears only for a name nobody has used.
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/create-rows.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createRows,
  draftHref,
  draftTypeOptions,
  firstPickIndex,
  flowFor,
  rowForKind,
  rowLabel,
  type CreateRow,
} from '@/lib/create/rows'
import type { NodeTypeConfig, SpaceFeatureConfig } from '@/lib/types'

const CUSTOM: NodeTypeConfig[] = [
  { name: 'Person', color: '#2563eb', shape: 'rectangle' },
  { name: 'Playbook', color: '#111111', shape: 'rectangle', scope: 'note' },
  { name: 'Deal', color: '#222222', shape: 'rectangle', scope: 'note' },
]

const admin = (over: Partial<Parameters<typeof createRows>[0]> = {}) => ({
  featureConfig: null,
  isAdmin: true,
  spaceNodeTypes: CUSTOM,
  pathname: '/directory',
  query: '',
  ...over,
})

const labels = (rows: CreateRow[]) => rows.map(rowLabel)

test('"New type" leads the unsearched list, and the keyboard starts below it', () => {
  const list = createRows(admin())
  assert.deepEqual(list.rows[0], { kind: 'new-type', name: '' })
  assert.equal(firstPickIndex(list), 1)
  assert.equal(list.rows[1]?.kind, 'type')
})

test('the page you are on ranks its kinds first, then a hairline, then the space types', () => {
  const { rows, dividerAt } = createRows(admin({ pathname: '/events' }))
  assert.equal(labels(rows)[1], 'Event')
  assert.equal(dividerAt, rows.length - 2)
  assert.deepEqual(labels(rows).slice(dividerAt!), ['Deal', 'Playbook'])
})

test('a member never sees the admin kinds, and channels off removes its containers', () => {
  const member = createRows(admin({ isAdmin: false }))
  const names = labels(member.rows)
  for (const gone of ['Channel', 'Section', 'Connector', 'Model']) assert.ok(!names.includes(gone), gone)
  assert.ok(names.includes('Agent'))

  const off: SpaceFeatureConfig = { enabled: { channels: false } } as SpaceFeatureConfig
  const noChannels = labels(createRows(admin({ featureConfig: off })).rows)
  assert.ok(!noChannels.includes('Channel'))
  assert.ok(!noChannels.includes('Section'))
  assert.ok(noChannels.includes('Connector'))
})

test('a search is one flat ranked list and resolves synonyms', () => {
  const { rows, dividerAt } = createRows(admin({ query: 'company' }))
  assert.equal(dividerAt, null)
  assert.equal(labels(rows)[0], 'Space')
  assert.equal(labels(createRows(admin({ query: 'pl' })).rows)[0], 'Playbook')
})

test('a NAMED "New type" row appears only for a legal, unused name', () => {
  const fresh = createRows(admin({ query: 'memo' })).rows.at(-1)
  assert.deepEqual(fresh, { kind: 'new-type', name: 'Memo' })
  // An existing type, a built-in's synonym, a reserved word and an illegal
  // name each get no such row.
  for (const q of ['playbook', 'org', 'index', 'tool', 'a/b']) {
    const rows = createRows(admin({ query: q })).rows
    assert.ok(!rows.some((r) => r.kind === 'new-type'), q)
  }
  // Whitespace is not a search: the list is the unsearched one, so the
  // standing row leads it and carries no name.
  assert.deepEqual(createRows(admin({ query: '  ' })).rows[0], { kind: 'new-type', name: '' })
})

test('every row resolves to a flow, and everything but a surface of its own is a draft', () => {
  const ctx = { folder: 'deals' }
  for (const row of createRows(admin()).rows) assert.ok(flowFor(row, ctx).kind)
  const kind = (k: Parameters<typeof rowForKind>[0]) => flowFor(rowForKind(k, admin())!, ctx)
  // The three that already own a create UI.
  assert.deepEqual(kind('event'), { kind: 'route', href: '/events/new' })
  assert.deepEqual(kind('connector'), { kind: 'route', href: '/admin?section=connectors' })
  assert.deepEqual(kind('model'), { kind: 'route', href: '/admin?section=models' })
  // Everything else is made on the draft — nothing is filled in beside the rail.
  assert.deepEqual(kind('context'), { kind: 'draft', href: '/directory/new?type=note&folder=deals' })
  assert.deepEqual(kind('person'), { kind: 'draft', href: '/directory/new?type=person&folder=deals' })
  assert.deepEqual(kind('agent'), { kind: 'draft', href: '/directory/new?type=agent&folder=deals' })
  assert.deepEqual(kind('file'), { kind: 'draft', href: '/directory/new?type=file&folder=deals' })
  assert.deepEqual(kind('channel'), { kind: 'draft', href: '/directory/new?type=channel&folder=deals' })
  assert.deepEqual(flowFor({ kind: 'custom', name: 'Playbook', color: '#111111' }, ctx), {
    kind: 'draft',
    href: '/directory/new?type=Playbook&folder=deals',
  })
  // A named "New type" carries the name and the flag that registers it; the
  // standing row carries neither, and the type menu is where one is named.
  assert.deepEqual(flowFor({ kind: 'new-type', name: 'Memo' }, ctx), {
    kind: 'draft',
    href: '/directory/new?type=Memo&folder=deals&new=1',
  })
  assert.deepEqual(flowFor({ kind: 'new-type', name: '' }, ctx), {
    kind: 'draft',
    href: '/directory/new?folder=deals',
  })
  // An alias picked off the kind's tree rides along.
  assert.deepEqual(flowFor(rowForKind('person', admin())!, { alias: 'Founder' }), {
    kind: 'draft',
    href: '/directory/new?type=person&alias=Founder',
  })
})

test('the draft offers exactly the kinds the panel lists', () => {
  const ids = draftTypeOptions(admin()).map((o) => o.id)
  assert.deepEqual(ids, ['person', 'space', 'resource', 'note', 'folder', 'file', 'channel', 'section', 'agent', 'tool'])
  // A member of a space with channels off sees neither a channel nor a section.
  const member = draftTypeOptions(admin({ isAdmin: false })).map((o) => o.id)
  assert.ok(!member.includes('channel') && !member.includes('section'))
  assert.ok(member.includes('note'))
})

test('a kind this person cannot make here has no row', () => {
  assert.equal(rowForKind('channel', admin({ isAdmin: false })), null)
  assert.equal(rowForKind('person', admin({ isAdmin: false }))?.kind, 'type')
})

test('draftHref carries only what it is given', () => {
  assert.equal(draftHref(null), '/directory/new')
  assert.equal(draftHref('note'), '/directory/new?type=note')
  assert.equal(draftHref('note', ''), '/directory/new?type=note')
})
