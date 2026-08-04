// Unit tests for the pure alias rules (lib/notes/shared/aliases.ts): who manages
// a community, and the one invariant the whole model rests on — a community can
// never be left with nobody able to manage it. The DB side
// (lib/notes/aliases.ts) is a thin wrapper that loads summaries and calls
// ownerSurvives before writing.
// Run: node --import tsx --test tests/aliases.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ownerHolderIds,
  ownerSurvives,
  aliasNameError,
  describeAliases,
  holdsOwner,
  normalizeAliasColor,
  MAX_ALIAS_NAME,
  OWNER_ALIAS_NAME,
  SYSTEM_ALIAS_MESSAGE,
  type AliasSummary,
} from '../lib/notes/shared/aliases'

const alias = (
  name: string,
  owner: boolean,
  holderIds: string[] = [],
  system = false,
): AliasSummary => ({ name, color: '#000', owner, system, holderIds })

/** The common shape: one owner alias held by one person, plus a plain alias. */
const soleOwner = (): AliasSummary[] => [
  alias('owner', true, ['u-1'], true),
  alias('eng', false, ['u-1', 'u-2']),
]

// --- who owns ------------------------------------------------------------------

test('holdsOwner is true only for holders of an alias marked owner', () => {
  const aliases = soleOwner()
  assert.equal(holdsOwner(aliases, 'u-1'), true)
  assert.equal(holdsOwner(aliases, 'u-2'), false) // holds eng, which does not own
  assert.equal(holdsOwner(aliases, 'nobody'), false)
})

test('holding several aliases is normal — any one of them owning is enough', () => {
  const aliases = [alias('board', true, ['u-2']), alias('eng', false, ['u-2'])]
  assert.equal(holdsOwner(aliases, 'u-2'), true)
})

test('ownerHolderIds deduplicates across multiple owner aliases', () => {
  const aliases = [
    alias('owner', true, ['u-1', 'u-2']),
    alias('board', true, ['u-2', 'u-3']),
    alias('eng', false, ['u-9']),
  ]
  assert.deepEqual(ownerHolderIds(aliases).sort(), ['u-1', 'u-2', 'u-3'])
})

test('an owner alias nobody holds confers nothing', () => {
  const aliases = [alias('owner', true, [])]
  assert.deepEqual(ownerHolderIds(aliases), [])
  assert.equal(holdsOwner(aliases, 'u-1'), false)
})

// --- the lockout invariant --------------------------------------------------------

test('removing the last holder of the only owner alias is refused', () => {
  assert.equal(
    ownerSurvives(soleOwner(), { kind: 'removeHolder', name: 'owner', userId: 'u-1' }),
    false,
  )
})

test('removing a holder is fine while a second owner alias still has one', () => {
  const aliases = [...soleOwner(), alias('board', true, ['u-2'])]
  assert.equal(
    ownerSurvives(aliases, { kind: 'removeHolder', name: 'owner', userId: 'u-1' }),
    true,
  )
})

test('removing a holder is fine while the same owner alias has another', () => {
  const aliases = [alias('owner', true, ['u-1', 'u-2'])]
  assert.equal(
    ownerSurvives(aliases, { kind: 'removeHolder', name: 'owner', userId: 'u-1' }),
    true,
  )
})

test('clearing the owner flag on the only owner alias is refused', () => {
  assert.equal(
    ownerSurvives(soleOwner(), { kind: 'setOwner', name: 'owner', owner: false }),
    false,
  )
})

test('setting the owner flag ON is never refused', () => {
  assert.equal(
    ownerSurvives(soleOwner(), { kind: 'setOwner', name: 'eng', owner: true }),
    true,
  )
  // Even from a community that has nobody managing it — turning owner on can
  // only ever add managers.
  const stranded = [alias('eng', false, ['u-2'])]
  assert.equal(ownerSurvives(stranded, { kind: 'setOwner', name: 'eng', owner: true }), true)
})

test('removing the only owner alias is refused; removing a plain one is not', () => {
  assert.equal(ownerSurvives(soleOwner(), { kind: 'removeAlias', name: 'owner' }), false)
  assert.equal(ownerSurvives(soleOwner(), { kind: 'removeAlias', name: 'eng' }), true)
})

test('a member leaving is refused when they are the last person managing it', () => {
  assert.equal(ownerSurvives(soleOwner(), { kind: 'removeMember', userIds: ['u-1'] }), false)
  assert.equal(ownerSurvives(soleOwner(), { kind: 'removeMember', userIds: ['u-2'] }), true)
})

test('a bulk removal is judged on the whole set, not one at a time', () => {
  const aliases = [alias('owner', true, ['u-1', 'u-2'])]
  // Either alone is safe...
  assert.equal(ownerSurvives(aliases, { kind: 'removeMember', userIds: ['u-1'] }), true)
  assert.equal(ownerSurvives(aliases, { kind: 'removeMember', userIds: ['u-2'] }), true)
  // ...but together they strip the community.
  assert.equal(ownerSurvives(aliases, { kind: 'removeMember', userIds: ['u-1', 'u-2'] }), false)
})

test('ownerSurvives does not mutate the aliases it is given', () => {
  const aliases = soleOwner()
  const before = JSON.stringify(aliases)
  ownerSurvives(aliases, { kind: 'removeHolder', name: 'owner', userId: 'u-1' })
  ownerSurvives(aliases, { kind: 'removeAlias', name: 'owner' })
  ownerSurvives(aliases, { kind: 'removeMember', userIds: ['u-1'] })
  assert.equal(JSON.stringify(aliases), before)
})

test('an unknown alias name leaves the community exactly as it was', () => {
  assert.equal(ownerSurvives(soleOwner(), { kind: 'removeAlias', name: 'ghost' }), true)
  assert.equal(
    ownerSurvives(soleOwner(), { kind: 'removeHolder', name: 'ghost', userId: 'u-1' }),
    true,
  )
})

// --- the built-in Owner alias ------------------------------------------------------

test('the built-in Owner alias is the one marked system', () => {
  const aliases = soleOwner()
  const owner = aliases.find((a) => a.name === 'owner')
  assert.equal(owner?.system, true)
  assert.equal(aliases.find((a) => a.name === 'eng')?.system, false)
})

test('SYSTEM_ALIAS_MESSAGE names Owner, so the refusal copy cannot drift', () => {
  assert.ok(SYSTEM_ALIAS_MESSAGE.includes(OWNER_ALIAS_NAME))
})

// --- naming (create / rename) -----------------------------------------------------

test('aliasNameError accepts a fresh name and rejects an empty one', () => {
  assert.equal(aliasNameError('Partner', ['Founder', 'LP']), null)
  assert.ok(aliasNameError('', ['Founder']))
  assert.ok(aliasNameError('   ', ['Founder']))
})

test('aliasNameError rejects a name already in use, case-insensitively', () => {
  assert.ok(aliasNameError('Founder', ['Founder']))
  assert.ok(aliasNameError('founder', ['Founder']))
  assert.ok(aliasNameError('  FOUNDER  ', ['Founder']))
})

test('aliasNameError reserves the built-in Owner name', () => {
  assert.ok(aliasNameError(OWNER_ALIAS_NAME, []))
  assert.ok(aliasNameError(OWNER_ALIAS_NAME.toLowerCase(), []))
  // …unless it IS Owner being left alone, which a no-op rename would be.
  assert.equal(aliasNameError(OWNER_ALIAS_NAME, [OWNER_ALIAS_NAME], OWNER_ALIAS_NAME), null)
})

test('aliasNameError lets an alias keep its own name when renaming', () => {
  // Renaming Founder → Founder is a no-op, not a collision with itself.
  assert.equal(aliasNameError('Founder', ['Founder', 'LP'], 'Founder'), null)
  // Changing only the casing is allowed for the same reason.
  assert.equal(aliasNameError('FOUNDER', ['Founder', 'LP'], 'Founder'), null)
  // But it still cannot take another alias's name.
  assert.ok(aliasNameError('LP', ['Founder', 'LP'], 'Founder'))
})

test('aliasNameError caps the length', () => {
  assert.equal(aliasNameError('x'.repeat(MAX_ALIAS_NAME), []), null)
  assert.ok(aliasNameError('x'.repeat(MAX_ALIAS_NAME + 1), []))
})

test('normalizeAliasColor accepts #rrggbb and nothing else', () => {
  assert.equal(normalizeAliasColor('#AABBCC'), '#aabbcc')
  assert.equal(normalizeAliasColor('  #0891b2 '), '#0891b2')
  assert.equal(normalizeAliasColor('#abc'), null) // shorthand is not stored
  assert.equal(normalizeAliasColor('red'), null)
  assert.equal(normalizeAliasColor('#aabbccdd'), null) // chips carry no alpha
  assert.equal(normalizeAliasColor(undefined), null)
})

// --- presentation -----------------------------------------------------------------

test('describeAliases lists up to max names, then counts the rest', () => {
  assert.equal(describeAliases([]), 'None')
  assert.equal(describeAliases(['Admin']), 'Admin')
  assert.equal(describeAliases(['Admin', 'Eng', 'Board']), 'Admin, Eng, Board')
  assert.equal(describeAliases(['Admin', 'Eng', 'Board', 'GTM']), 'Admin, Eng, Board +1')
  assert.equal(describeAliases(['Admin', 'Eng', 'Board', 'GTM'], 2), 'Admin, Eng +2')
})
