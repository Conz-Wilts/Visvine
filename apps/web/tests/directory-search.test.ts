// The pure half of the directory finder: type spellings, per-identity
// collapse, and spaces leading (and swallowing) same-named directory records.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapseByIdentity, dbTypesFor, fieldScore, mergeSearchResults, type SearchResult, type SearchRow } from '../lib/directory/shared/search'
import { GLOBAL_SPACE_ID } from '../lib/spaces/globalSpace'

function row(over: Partial<SearchRow> & { id: string }): SearchRow {
  return {
    name: over.id,
    subtitle: null,
    location: null,
    tags: [],
    image_url: null,
    space_id: 'sp1',
    identity_id: null,
    metadata: null,
    space_name: 'Space One',
    ...over,
  }
}

test('dbTypesFor accepts every spelling an organisation has worn, and passes unknown kinds through', () => {
  assert.ok(dbTypesFor('Space').includes('company'))
  assert.ok(dbTypesFor('space').includes('org'))
  assert.deepEqual(dbTypesFor('person'), ['person', 'people'])
  assert.deepEqual(dbTypesFor('Widget'), ['widget'])
})

test('fieldScore counts the filled fields, email included', () => {
  assert.equal(fieldScore(row({ id: 'a' })), 0)
  assert.equal(fieldScore(row({ id: 'b', subtitle: 'CEO', tags: ['x'], metadata: { email: 'b@x' } })), 3)
})

test('collapseByIdentity keeps one entry per identity, the fullest row representing, every space named', () => {
  const rows = [
    row({ id: 'n1', identity_id: 'craig', name: 'Craig', space_id: 'sp1', space_name: 'Space One' }),
    row({ id: 'n2', identity_id: 'craig', name: 'Craig P', subtitle: 'Founder', space_id: 'sp2', space_name: 'Space Two' }),
    row({ id: 'n3', identity_id: null, name: 'Nobody', space_id: 'sp1' }),
  ]
  const out = collapseByIdentity(rows)
  assert.equal(out.length, 2)
  assert.equal(out[0].id, 'n2')
  assert.deepEqual(out[0].spaces.sort(), ['Space One', 'Space Two'])
  assert.equal(out[1].id, 'n3')
  assert.equal(out[0].global, false)
})

test('the Visvine record leads its identity group regardless of field count, and sorts first', () => {
  const rows = [
    row({ id: 'n1', identity_id: 'a', name: 'Amy', subtitle: 'Lots', location: 'AKL', tags: ['x'] }),
    row({ id: 'g1', identity_id: 'a', name: 'Amy', space_id: GLOBAL_SPACE_ID, space_name: 'Visvine' }),
    row({ id: 'n9', identity_id: 'z', name: 'Aaron' }),
  ]
  const out = collapseByIdentity(rows)
  assert.equal(out[0].id, 'g1')
  assert.equal(out[0].global, true)
  assert.equal(out[1].id, 'n9')
})

test('mergeSearchResults puts spaces first, drops same-named nodes, and caps the list', () => {
  const space = (name: string): SearchResult => ({
    id: `s:${name}`, identity_id: null, name, subtitle: null, location: null, tags: [], image_url: null,
    space_id: null, space_name: null, spaces: [], metadata: { spaceRef: name },
  })
  const nodes = collapseByIdentity([
    row({ id: 'n1', name: ' movac ' }),
    row({ id: 'n2', name: 'Other' }),
    row({ id: 'n3', name: 'Third' }),
  ])
  const out = mergeSearchResults([space('Movac')], nodes, 2)
  assert.deepEqual(out.map((r) => r.id), ['s:Movac', 'n2'])
})
