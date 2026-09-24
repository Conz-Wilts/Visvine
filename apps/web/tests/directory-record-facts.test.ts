// The Directory's record facts: who a note's last revision names
// (lib/directory/recordFacts.ts#editorOf).

import test from 'node:test'
import assert from 'node:assert/strict'

import { editorOf } from '../lib/directory/recordFacts'

test('a person saving is named by their display name', () => {
  assert.equal(editorOf({ editor: 'Ana', origin: 'edit', model: null }), 'Ana')
})

test("an agent's run is named by the agent, not the person it runs as", () => {
  assert.equal(editorOf({ editor: 'Ana', origin: 'agent', model: 'agent:digest' }), 'digest')
})

test('a baseline or an unknown editor names nobody', () => {
  assert.equal(editorOf({ editor: 'Ana', origin: 'baseline', model: null }), null)
  assert.equal(editorOf({ editor: 'Unknown', origin: 'edit', model: null }), null)
})
