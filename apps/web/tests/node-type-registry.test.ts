// Unit tests for the one rule that decides whether a community may add a type
// to its vocabulary — shared by the member endpoint, the console and the
// backfill script.
// Run: node --import tsx --test tests/node-type-registry.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_NODE_TYPES } from '../lib/types/context'
import {
  defaultNodeTypeColor,
  isReservedTypeName,
  mergeNodeType,
  mergeNodeTypeList,
  normalizeTypeName,
  seedNodeTypes,
} from '../lib/types/nodeTypeRegistry'

const ok = (r: ReturnType<typeof mergeNodeType>) => {
  assert.equal(r.ok, true, r.ok ? '' : r.error)
  return r as Extract<typeof r, { ok: true }>
}

test('a new name is added, seeded on top of the defaults', () => {
  const r = ok(mergeNodeType(null, { name: 'playbook', color: '#3b82f6' }))
  assert.equal(r.created, true)
  assert.deepEqual(r.type, { name: 'Playbook', color: '#3b82f6', shape: 'rectangle', scope: 'note' })
  // An empty column must not become a one-entry vocabulary.
  assert.equal(r.types.length, DEFAULT_NODE_TYPES.length + 1)
  assert.ok(r.types.some((t) => t.name === 'Person'))
})

test('re-adding is idempotent and keeps the first colour', () => {
  const first = ok(mergeNodeType(null, { name: 'Playbook', color: '#3b82f6' }))
  const second = ok(mergeNodeType(first.types, { name: 'playbook', color: '#f43f5e' }))
  assert.equal(second.created, false)
  assert.equal(second.type.color, '#3b82f6')
  assert.equal(second.types.length, first.types.length)
})

test('a synonym of a built-in is already served', () => {
  // Company / Org / Group all fold onto Space.
  for (const name of ['Company', 'org', 'GROUP', 'communities']) {
    const r = ok(mergeNodeType(null, { name, color: '#3b82f6' }))
    assert.equal(r.created, false, `${name} should resolve to an existing type`)
    assert.equal(r.type.name, 'Space')
  }
})

test('a built-in under its own name is already served', () => {
  const r = ok(mergeNodeType(null, { name: 'person', color: '#3b82f6' }))
  assert.equal(r.created, false)
  assert.equal(r.type.name, 'Person')
})

test('reserved names are refused whatever their casing', () => {
  for (const name of ['Note', 'note', 'INDEX', 'file']) {
    const r = mergeNodeType(null, { name, color: '#3b82f6' })
    assert.equal(r.ok, false, `${name} must be reserved`)
    assert.ok(isReservedTypeName(name))
  }
})

test('three-digit hex is refused — hexToRgb slices six characters', () => {
  assert.equal(mergeNodeType(null, { name: 'Playbook', color: '#abc' }).ok, false)
  assert.equal(mergeNodeType(null, { name: 'Playbook', color: 'blue' }).ok, false)
  assert.equal(mergeNodeType(null, { name: 'Playbook', color: '#aabbcc' }).ok, true)
})

test('a missing colour falls back to a deterministic palette pick', () => {
  const r = ok(mergeNodeType(null, { name: 'Playbook' }))
  assert.equal(r.type.color, defaultNodeTypeColor('playbook'))
  assert.match(r.type.color, /^#[0-9a-f]{6}$/i)
})

test('names are trimmed, collapsed and capitalised', () => {
  assert.equal(normalizeTypeName('  design   doc '), 'Design doc')
  assert.equal(ok(mergeNodeType(null, { name: '  playbook ' })).type.name, 'Playbook')
})

test('empty, overlong and path-unsafe names are refused', () => {
  for (const name of ['', '   ', 'a'.repeat(33), 'field/notes', 'person:1', '#tag']) {
    assert.equal(mergeNodeType(null, { name }).ok, false, `${name || '(blank)'} must be refused`)
  }
})

test('a stale whole-record save cannot delete a type it never knew about', () => {
  const stored = [
    { name: 'Person', color: '#2563eb', shape: 'rectangle' as const },
    { name: 'Playbook', color: '#3b82f6', shape: 'rectangle' as const, scope: 'note' as const },
  ]
  // The console PUTs a snapshot taken before Playbook existed, recolouring Person.
  const saved = mergeNodeTypeList(stored, [{ name: 'Person', color: '#123456', shape: 'rectangle' }])
  assert.deepEqual(saved.map((t) => t.name), ['Person', 'Playbook'])
  assert.equal(saved[0].color, '#123456')
  assert.equal(saved[1].scope, 'note')
})

test('a type only the payload has is appended, and order is kept', () => {
  const stored = [{ name: 'Person', color: '#2563eb', shape: 'rectangle' as const }]
  const saved = mergeNodeTypeList(stored, [
    { name: 'Event', color: '#ef4444', shape: 'rectangle' },
    { name: 'person', color: '#111111', shape: 'rectangle' },
  ])
  // Stored order first (recoloured in place, matched case-insensitively), then
  // the genuinely new entry — a recolour must not shuffle the vocabulary.
  assert.deepEqual(saved.map((t) => t.name), ['person', 'Event'])
  assert.equal(saved[0].color, '#111111')
})

test('a stored vocabulary is left alone rather than reseeded', () => {
  const stored = [{ name: 'Person', color: '#2563eb', shape: 'rectangle' as const }]
  assert.deepEqual(seedNodeTypes(stored), stored)
  const r = ok(mergeNodeType(stored, { name: 'Playbook', color: '#3b82f6' }))
  assert.equal(r.types.length, 2)
})
