// Unit tests for the plural rule and the space's override (lib/types/plural).
// Run: node --import tsx --test tests/type-plural.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeTypePlural, pluralTypeName, pluralizeTypeWord } from '@/lib/types/plural'
import { mergeNodeTypeList } from '@/lib/types/nodeTypeRegistry'
import type { NodeTypeConfig } from '@/lib/types/context'

const type = (name: string, plural?: string): NodeTypeConfig =>
  plural === undefined
    ? { name, color: '#2563eb', shape: 'rectangle' }
    : { name, color: '#2563eb', shape: 'rectangle', plural }

test('the rule inflects the head word of a type name', () => {
  assert.equal(pluralizeTypeWord('Person'), 'People')
  assert.equal(pluralizeTypeWord('PERSON'), 'PEOPLE')
  assert.equal(pluralizeTypeWord('Board Member'), 'Board Members')
  assert.equal(pluralizeTypeWord('Point Person'), 'Point People')
  assert.equal(pluralizeTypeWord('Company'), 'Companies')
  assert.equal(pluralizeTypeWord('Class'), 'Classes')
  assert.equal(pluralizeTypeWord('Pitch'), 'Pitches')
  assert.equal(pluralizeTypeWord('Analysis'), 'Analyses')
  assert.equal(pluralizeTypeWord('BigQuery Table'), 'BigQuery Tables')
})

test('the rule leaves alone what is already plural or has no plural', () => {
  assert.equal(pluralizeTypeWord('Metrics'), 'Metrics')
  assert.equal(pluralizeTypeWord('Series'), 'Series')
  assert.equal(pluralizeTypeWord('Staff'), 'Staff')
  assert.equal(pluralizeTypeWord(''), '')
})

test('a space overrides the plural the rule gets wrong', () => {
  const types = [type('Person'), type('Point of contact', 'Points of contact')]
  assert.equal(pluralTypeName('Point of contact', types), 'Points of contact')
  // Matched on the type's own name, case-insensitively, and derived when absent.
  assert.equal(pluralTypeName('person', types), 'People')
  assert.equal(pluralTypeName('Playbook', types), 'Playbooks')
  assert.equal(pluralTypeName('Playbook'), 'Playbooks')
})

test('an override is stored only when it says something the rule does not', () => {
  assert.equal(normalizeTypePlural('  Points  of contact ', 'Point of contact'), 'Points of contact')
  assert.equal(normalizeTypePlural('', 'Person'), undefined)
  assert.equal(normalizeTypePlural('   ', 'Person'), undefined)
  // Redundant: the rule already says this, so nothing is stored and a later
  // rename keeps deriving.
  assert.equal(normalizeTypePlural('people', 'Person'), undefined)
  // Not label-shaped — a plural is a word on a tab, never a path.
  assert.equal(normalizeTypePlural('people/index.md', 'Person'), undefined)
})

test('the merge cleans a plural on the way in and drops a blank one', () => {
  const merged = mergeNodeTypeList(
    [type('Person', 'Persons')],
    [type('Person', '  '), type('Point of contact', 'Points of contact')],
  )
  assert.equal(Object.hasOwn(merged[0], 'plural'), false)
  assert.equal(merged[1].plural, 'Points of contact')
})

test('a built-in says its plural by rule, whatever a space stored', () => {
  assert.equal(pluralTypeName('Person', [type('Person', 'Humans')]), 'People')
  assert.equal(normalizeTypePlural('Humans', 'Person'), undefined)
  assert.equal(normalizeTypePlural('Guidebooks', 'Playbook'), 'Guidebooks')
})
