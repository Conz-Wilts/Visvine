// Unit tests for the space-config declaration/projection split
// (lib/spaces/configNote.ts + configHook.ts): serializing the config columns
// into settings/*.md, parsing an edited note back into a patch, and the
// no-op comparison that stops the two directions bouncing off each other.
// Run: node --import tsx --test tests/space-config-note.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CONFIG_NOTE_PATHS,
  configNoteKindOf,
  isSettingsPath,
  ownerAliasDenial,
  parseConfigNote,
  serializeConfigNote,
} from '../lib/spaces/configNote'
import { patchIsNoOp } from '../lib/spaces/configHook'
import { parseFrontmatter } from '../lib/notes/shared/markdown'
import type { SpaceConfig } from '../lib/spaces/spaceConfig'

const config: SpaceConfig = {
  nodeTypes: [
    { name: 'Person', color: '#2563eb', shape: 'rectangle' },
    { name: 'Space', color: '#78d870', shape: 'square' },
  ],
  linkTypes: [
    { name: 'Related', color: '#94a3b8', directed: false },
    { name: 'Mentioned', color: '#8b5cf6', directed: false, system: true },
  ],
  aliases: [{ id: 'a1', name: 'Owner', color: '#b4881b', nodeType: 'Person', owner: true, system: true }],
  featureConfig: { enabled: { directory: true, notes: true } },
  designConfig: { accent: '#78d870' },
} as SpaceConfig

// paths

test('config note paths are recognised, and settings/ is a protected prefix', () => {
  assert.equal(configNoteKindOf('settings/types.md'), 'types')
  assert.equal(configNoteKindOf('/settings/features.md'), 'features') // leading slash tolerated
  assert.equal(configNoteKindOf('settings/notes.md'), null) // inside settings/, but not a config note
  assert.equal(configNoteKindOf('people/craig.md'), null)

  assert.ok(isSettingsPath('settings'))
  assert.ok(isSettingsPath('settings/anything.md'))
  assert.ok(!isSettingsPath('settings-archive/old.md')) // prefix, not a folder boundary
})

// round trip

test('every config note round-trips through serialize → parse unchanged', () => {
  for (const kind of Object.keys(CONFIG_NOTE_PATHS) as (keyof typeof CONFIG_NOTE_PATHS)[]) {
    const { patch, errors } = parseConfigNote(kind, serializeConfigNote(kind, config))
    assert.deepEqual(errors, [], `${kind} did not parse`)
    assert.ok(patchIsNoOp(patch, config), `${kind} round-trip changed the config`)
  }
})

test('the serialized note carries the frontmatter the review pass expects', () => {
  const fm = parseFrontmatter(serializeConfigNote('features', config))
  assert.equal(fm.type, 'Settings')
  assert.equal(fm.title, 'Features')
  assert.ok(typeof fm.description === 'string' && fm.description.length > 0)
  assert.deepEqual(fm.featureConfig, { enabled: { directory: true, notes: true } })
})

// parsing an edited note

test('an edited note produces a patch for only the keys it mentions', () => {
  const { patch, errors } = parseConfigNote(
    'features',
    '---\ntitle: Features\nfeatureConfig:\n  directory: false\n---\n\nTurned off for the pilot.\n',
  )
  assert.deepEqual(errors, [])
  assert.deepEqual(patch, { featureConfig: { directory: false } })
})

test('a key deleted from the note leaves that column alone rather than wiping it', () => {
  // "not mentioned" and "set to empty" must not be the same thing: an admin
  // trimming the note must never silently erase the space's vocabulary.
  const { patch, errors } = parseConfigNote('types', '---\ntitle: Types\n---\n\nNothing here.\n')
  assert.deepEqual(errors, [])
  assert.deepEqual(patch, {})
})

test('malformed values are reported and the patch is withheld entirely', () => {
  const { patch, errors } = parseConfigNote(
    'types',
    '---\ntitle: Types\nnodeTypes:\n  - name: Person\n    color: blue\n    shape: rectangle\n  - name: Person\n    color: "#2563eb"\n    shape: rectangle\n---\n\nx\n',
  )
  assert.equal(Object.keys(patch).length, 0, 'a note with any error must not be applied at all')
  assert.equal(errors.length, 2)
  assert.match(errors[0], /color must be a hex string/)
  assert.match(errors[1], /duplicate name/)
})

test('an unknown shape is refused rather than coerced', () => {
  const { errors } = parseConfigNote(
    'types',
    '---\ntitle: Types\nnodeTypes:\n  - name: Person\n    color: "#2563eb"\n    shape: octagon\n---\n\nx\n',
  )
  assert.equal(errors.length, 1)
  assert.match(errors[0], /shape must be one of/)
})

test('a space with no owner alias parses fine — plenty of real ones have none', () => {
  // Spaces administered by super admins, or seeded before the Owner alias, have
  // an empty owner set and must keep round-tripping through their own note.
  const { patch, errors } = parseConfigNote(
    'types',
    '---\ntitle: Types\naliases:\n  - name: Member\n    color: "#2563eb"\n    nodeType: Person\n---\n\nx\n',
  )
  assert.deepEqual(errors, [])
  assert.equal(patch.aliases?.length, 1)
})

test('ownerAliasDenial refuses removing the LAST owner, and only that', () => {
  const owner = { name: 'Owner', color: '#b4881b', nodeType: 'Person', owner: true }
  const member = { name: 'Member', color: '#2563eb', nodeType: 'Person' }

  // some → none: refused. This is the edit that locks everybody out of their
  // own console, with nobody left allowed to undo it.
  assert.match(
    ownerAliasDenial({ aliases: [member] }, { aliases: [owner, member] }) ?? '',
    /last alias with `owner: true`/,
  )
  // none → none: fine, nothing was lost.
  assert.equal(ownerAliasDenial({ aliases: [member] }, { aliases: [member] }), null)
  // some → some: fine.
  assert.equal(ownerAliasDenial({ aliases: [owner] }, { aliases: [owner, member] }), null)
  // a patch that does not mention aliases cannot remove one.
  assert.equal(ownerAliasDenial({}, { aliases: [owner] }), null)
})

test('a non-object where a list belongs is an error, not a silent skip', () => {
  const { errors } = parseConfigNote('features', '---\ntitle: F\nfeatureConfig: "on"\n---\n\nx\n')
  assert.deepEqual(errors, ['featureConfig: expected an object'])
})

// the loop guard

test('patchIsNoOp ignores key order and only weighs the keys the patch mentions', () => {
  assert.ok(patchIsNoOp({ featureConfig: { enabled: { notes: true, directory: true } } }, config))
  assert.ok(patchIsNoOp({}, config))
  assert.ok(!patchIsNoOp({ featureConfig: { enabled: { directory: false } } }, config))
  // A patch that matches on one key and differs on another is NOT a no-op.
  assert.ok(
    !patchIsNoOp({ featureConfig: { enabled: { directory: true, notes: true } }, designConfig: {} }, config),
  )
})
