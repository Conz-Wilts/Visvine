// Unit tests for the route → "Create new" suggestion mapping that pins the most
// likely type at the top of the create panel.
// Run: node --import tsx --test tests/create-suggested-type.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { suggestedCreateType } from '../lib/create/suggestedType'

test('maps each feature route to its create type', () => {
  assert.equal(suggestedCreateType('/events')?.type, 'event')
  assert.equal(suggestedCreateType('/resources')?.type, 'resource')
  assert.equal(suggestedCreateType('/channels')?.type, 'channel')
  assert.equal(suggestedCreateType('/context')?.type, 'context')
  assert.equal(suggestedCreateType('/directory')?.type, 'person')
})

test('matches nested routes under a mapped section', () => {
  assert.equal(suggestedCreateType('/events/new')?.type, 'event')
  assert.equal(suggestedCreateType('/events/abc/manage')?.type, 'event')
  assert.equal(suggestedCreateType('/channels/conv_123')?.type, 'channel')
  assert.equal(suggestedCreateType('/directory/person:jane')?.type, 'person')
})

test('note and source viewers suggest Context, not Person', () => {
  assert.equal(suggestedCreateType('/directory/note/research/thesis')?.type, 'context')
  assert.equal(suggestedCreateType('/directory/source/decks/pitch')?.type, 'context')
})

test('a prefix only matches on a path boundary', () => {
  // Not a nested /events route — must not inherit the Event suggestion.
  assert.equal(suggestedCreateType('/eventsomething'), null)
})

test('unmapped routes get no suggestion', () => {
  for (const p of ['/home', '/discover', '/messages', '/settings', '/admin', '/tasks', '/analytics', '/']) {
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
