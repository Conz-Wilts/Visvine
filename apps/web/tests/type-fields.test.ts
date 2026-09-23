// Unit tests for the note-first create surface's per-type property schema:
// which rows each type shows, how a flat form state splits into node columns vs
// metadata, and the round-trip back out of a saved node.
// Run: node --import tsx --test tests/create-type-fields.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { applyFields, fieldDef, fieldsForType, readFields } from '../lib/types/typeFields'

// type lookup

test('fieldsForType is case-insensitive and follows the stored lowercase type', () => {
  assert.deepEqual(fieldsForType('Person'), fieldsForType('person'))
  assert.ok(fieldsForType('person').length > 0)
})

test('fieldsForType folds every retired organisation spelling onto the space schema', () => {
  const space = fieldsForType('space')
  assert.ok(space.length > 0)
  for (const synonym of ['organization', 'organisation', 'org', 'group', 'groups', 'company', 'companies', 'community', 'communities']) {
    assert.deepEqual(fieldsForType(synonym), space, `${synonym} should resolve to the space schema`)
  }
})

test('fieldsForType returns an empty array for unknown and empty types', () => {
  assert.deepEqual(fieldsForType('note'), [])
  assert.deepEqual(fieldsForType('sector'), [])
  assert.deepEqual(fieldsForType(''), [])
  assert.deepEqual(fieldsForType(null), [])
  assert.deepEqual(fieldsForType(undefined), [])
})

test('every column-targeted field names its column', () => {
  for (const type of ['person', 'space', 'resource', 'event']) {
    for (const field of fieldsForType(type)) {
      if (field.target === 'column') {
        assert.ok(field.column, `${type}.${field.key} targets a column but names none`)
      }
    }
  }
})

// The identity resolver reads these exact metadata keys; a rename here silently
// breaks cross-space matching with no error, so pin them.
test('person carries the metadata keys identity resolution reads', () => {
  for (const key of ['email', 'companyName', 'linkedinUrl']) {
    const def = fieldDef('person', key)
    assert.ok(def, `person is missing the ${key} field`)
    assert.equal(def.target, 'metadata')
  }
})

test('a space website mirrors into the metadata key the org resolver reads', () => {
  const def = fieldDef('space', 'url')
  assert.ok(def)
  assert.equal(def.column, 'url')
  assert.equal(def.mirrorMetadataKey, 'website')
})

// eventRepo writes snake_case; the profile details section reads through this
// table, so camelCase here would render a permanently blank Date row.
test('event date keys stay snake_case to match eventRepo', () => {
  assert.ok(fieldDef('event', 'start_at'))
  assert.ok(fieldDef('event', 'end_at'))
  assert.equal(fieldDef('event', 'startAt'), null)
})

// applyFields

test('applyFields splits values into node columns and metadata', () => {
  const { node, metadata } = applyFields('person', {
    subtitle: 'Founder, Halter',
    email: 'craig@halter.io',
    companyName: 'Halter',
    location: 'Auckland, NZ',
  })
  assert.deepEqual(node, { subtitle: 'Founder, Halter', location: 'Auckland, NZ' })
  assert.deepEqual(metadata, { email: 'craig@halter.io', companyName: 'Halter' })
})

test('applyFields writes a mirrored column to both places', () => {
  const { node, metadata } = applyFields('space', { url: 'halter.io' })
  assert.equal(node.url, 'halter.io')
  assert.equal(metadata.website, 'halter.io')
})

test('applyFields trims and drops blanks rather than storing empty strings', () => {
  const { node, metadata } = applyFields('person', {
    subtitle: '  Founder  ',
    email: '   ',
    companyName: '',
  })
  assert.equal(node.subtitle, 'Founder')
  assert.deepEqual(metadata, {})
  assert.equal('email' in metadata, false)
})

test('applyFields ignores keys that do not belong to the type', () => {
  // State left over from a type the user selected and then changed away from.
  const { node, metadata } = applyFields('resource', {
    subtitle: 'A playbook',
    email: 'craig@halter.io',
    founded: '2016',
  })
  assert.deepEqual(node, { subtitle: 'A playbook' })
  assert.deepEqual(metadata, {})
})

test('applyFields coerces number fields', () => {
  const { metadata } = applyFields('space', { founded: '2016', memberCount: '120' })
  assert.equal(metadata.founded, 2016)
  assert.equal(metadata.memberCount, 120)
})

test('applyFields on a type with no schema yields nothing', () => {
  const { node, metadata } = applyFields('note', { subtitle: 'ignored' })
  assert.deepEqual(node, {})
  assert.deepEqual(metadata, {})
})

// readFields

test('readFields round-trips applyFields', () => {
  const values = { subtitle: 'Founder', email: 'craig@halter.io', location: 'Auckland' }
  const { node, metadata } = applyFields('person', values)
  const back = readFields({ type: 'person', ...node, metadata })
  assert.deepEqual(back, values)
})

test('readFields omits unset columns and metadata rather than emitting empties', () => {
  const back = readFields({ type: 'person', subtitle: null, location: undefined, metadata: {} })
  assert.deepEqual(back, {})
})

test('readFields stringifies numeric metadata for the input rows', () => {
  const back = readFields({ type: 'space', metadata: { founded: 2016 } })
  assert.equal(back.founded, '2016')
})
