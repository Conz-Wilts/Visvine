// Unit tests for the route → "Create new" suggestion mapping that pins the most
// likely types at the top of the create panel.
// Run: node --import tsx --test tests/create-suggested-type.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { suggestedCreateType } from '../lib/create/suggestedType'

test('maps each feature route to its create types', () => {
  assert.deepEqual(suggestedCreateType('/events')?.types, ['event'])
  assert.deepEqual(suggestedCreateType('/resources')?.types, ['resource'])
  assert.deepEqual(suggestedCreateType('/directory')?.types, ['person'])
})

test('a surface whose tools create several things suggests them all', () => {
  // Channels is where both channels and spaces are made.
  assert.deepEqual(suggestedCreateType('/channels')?.types, ['channel', 'space'])
  // Context takes notes and uploaded files. (/context itself just redirects to
  // the Directory's Context tab, so only the note/source viewers map.)
  assert.deepEqual(suggestedCreateType('/directory/note/people/craig.md')?.types, ['context', 'file'])
})

test('matches nested routes under a mapped section', () => {
  assert.deepEqual(suggestedCreateType('/events/new')?.types, ['event'])
  assert.deepEqual(suggestedCreateType('/events/abc/manage')?.types, ['event'])
  assert.deepEqual(suggestedCreateType('/channels/conv_123')?.types, ['channel', 'space'])
  assert.deepEqual(suggestedCreateType('/directory/person:jane')?.types, ['person'])
})

test('note and source viewers suggest Context, not Person', () => {
  assert.equal(suggestedCreateType('/directory/note/research/thesis')?.types[0], 'context')
  assert.equal(suggestedCreateType('/directory/source/decks/pitch')?.types[0], 'context')
})

test('a prefix only matches on a path boundary', () => {
  // Not a nested /events route — must not inherit the Event suggestion.
  assert.equal(suggestedCreateType('/eventsomething'), null)
})

test('unmapped routes get no suggestion', () => {
  for (const p of ['/home', '/discover', '/settings', '/admin', '/']) {
    assert.equal(suggestedCreateType(p), null, `expected no suggestion for ${p}`)
  }
})

test('tolerates a missing pathname', () => {
  assert.equal(suggestedCreateType(null), null)
  assert.equal(suggestedCreateType(undefined), null)
  assert.equal(suggestedCreateType(''), null)
})

test('carries a human reason for the suggested row', () => {
  assert.equal(suggestedCreateType('/events')?.reason, "You're on Events")
  assert.equal(suggestedCreateType('/directory')?.reason, "You're in the Directory")
})
