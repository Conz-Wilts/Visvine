// Unit tests for the pure alias rules (lib/notes/shared/aliases.ts): who manages
// a space, and the one invariant the whole model rests on — a space can
// never be left with nobody able to manage it. The DB side
// (lib/notes/aliases.ts) is a thin wrapper that loads summaries and calls
// adminSurvives before writing.
// Run: node --import tsx --test tests/aliases.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  adminHolderIds,
  adminSurvives,
  aliasNameError,
  describeAliases,
  holdsAdmin,
  normalizeAliasColor,
  MAX_ALIAS_NAME,
  ADMIN_ALIAS_NAME,
  SYSTEM_ALIAS_MESSAGE,
  summarize,
  type AliasSummary,
} from '../lib/notes/shared/aliases'
import {
  findAliasByRef,
  personAliases,
  selfJoinAliases,
  ADMIN_ALIAS_ID,
  type SpaceAlias,
} from '../lib/types/context'

const alias = (
  name: string,
  admin: boolean,
  holderIds: string[] = [],
  system = false,
): AliasSummary => ({ name, color: '#000', admin, system, holderIds })

/** The common shape: one admin alias held by one person, plus a plain alias. */
const soleAdmin = (): AliasSummary[] => [
  alias('admin', true, ['u-1'], true),
  alias('eng', false, ['u-1', 'u-2']),
]

// who owns

test('holdsAdmin is true only for holders of an alias marked admin', () => {
  const aliases = soleAdmin()
  assert.equal(holdsAdmin(aliases, 'u-1'), true)
  assert.equal(holdsAdmin(aliases, 'u-2'), false) // holds eng, which does not own
  assert.equal(holdsAdmin(aliases, 'nobody'), false)
})

test('holding several aliases is normal — any one of them owning is enough', () => {
  const aliases = [alias('board', true, ['u-2']), alias('eng', false, ['u-2'])]
  assert.equal(holdsAdmin(aliases, 'u-2'), true)
})

test('adminHolderIds deduplicates across multiple admin aliases', () => {
  const aliases = [
    alias('admin', true, ['u-1', 'u-2']),
    alias('board', true, ['u-2', 'u-3']),
    alias('eng', false, ['u-9']),
  ]
  assert.deepEqual(adminHolderIds(aliases).sort(), ['u-1', 'u-2', 'u-3'])
})

test('an admin alias nobody holds confers nothing', () => {
  const aliases = [alias('admin', true, [])]
  assert.deepEqual(adminHolderIds(aliases), [])
  assert.equal(holdsAdmin(aliases, 'u-1'), false)
})

// the lockout invariant

test('removing the last holder of the only admin alias is refused', () => {
  assert.equal(
    adminSurvives(soleAdmin(), { kind: 'removeHolder', name: 'admin', userId: 'u-1' }),
    false,
  )
})

test('removing a holder is fine while a second admin alias still has one', () => {
  const aliases = [...soleAdmin(), alias('board', true, ['u-2'])]
  assert.equal(
    adminSurvives(aliases, { kind: 'removeHolder', name: 'admin', userId: 'u-1' }),
    true,
  )
})

test('removing a holder is fine while the same admin alias has another', () => {
  const aliases = [alias('admin', true, ['u-1', 'u-2'])]
  assert.equal(
    adminSurvives(aliases, { kind: 'removeHolder', name: 'admin', userId: 'u-1' }),
    true,
  )
})

test('clearing the admin flag on the only admin alias is refused', () => {
  assert.equal(
    adminSurvives(soleAdmin(), { kind: 'setAdmin', name: 'admin', admin: false }),
    false,
  )
})

test('setting the admin flag ON is never refused', () => {
  assert.equal(
    adminSurvives(soleAdmin(), { kind: 'setAdmin', name: 'eng', admin: true }),
    true,
  )
  // Even from a space that has nobody managing it — turning admin on can
  // only ever add managers.
  const stranded = [alias('eng', false, ['u-2'])]
  assert.equal(adminSurvives(stranded, { kind: 'setAdmin', name: 'eng', admin: true }), true)
})

test('removing the only admin alias is refused; removing a plain one is not', () => {
  assert.equal(adminSurvives(soleAdmin(), { kind: 'removeAlias', name: 'admin' }), false)
  assert.equal(adminSurvives(soleAdmin(), { kind: 'removeAlias', name: 'eng' }), true)
})

test('a member leaving is refused when they are the last person managing it', () => {
  assert.equal(adminSurvives(soleAdmin(), { kind: 'removeMember', userIds: ['u-1'] }), false)
  assert.equal(adminSurvives(soleAdmin(), { kind: 'removeMember', userIds: ['u-2'] }), true)
})

test('a bulk removal is judged on the whole set, not one at a time', () => {
  const aliases = [alias('admin', true, ['u-1', 'u-2'])]
  // Either alone is safe...
  assert.equal(adminSurvives(aliases, { kind: 'removeMember', userIds: ['u-1'] }), true)
  assert.equal(adminSurvives(aliases, { kind: 'removeMember', userIds: ['u-2'] }), true)
  // ...but together they strip the space.
  assert.equal(adminSurvives(aliases, { kind: 'removeMember', userIds: ['u-1', 'u-2'] }), false)
})

test('adminSurvives does not mutate the aliases it is given', () => {
  const aliases = soleAdmin()
  const before = JSON.stringify(aliases)
  adminSurvives(aliases, { kind: 'removeHolder', name: 'admin', userId: 'u-1' })
  adminSurvives(aliases, { kind: 'removeAlias', name: 'admin' })
  adminSurvives(aliases, { kind: 'removeMember', userIds: ['u-1'] })
  assert.equal(JSON.stringify(aliases), before)
})

test('an unknown alias name leaves the space exactly as it was', () => {
  assert.equal(adminSurvives(soleAdmin(), { kind: 'removeAlias', name: 'ghost' }), true)
  assert.equal(
    adminSurvives(soleAdmin(), { kind: 'removeHolder', name: 'ghost', userId: 'u-1' }),
    true,
  )
})

// the built-in Admin alias

test('the built-in Admin alias is the one marked system', () => {
  const aliases = soleAdmin()
  const admin = aliases.find((a) => a.name === 'admin')
  assert.equal(admin?.system, true)
  assert.equal(aliases.find((a) => a.name === 'eng')?.system, false)
})

test('SYSTEM_ALIAS_MESSAGE names Admin, so the refusal copy cannot drift', () => {
  assert.ok(SYSTEM_ALIAS_MESSAGE.includes(ADMIN_ALIAS_NAME))
})

// naming (create / rename)

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

test('aliasNameError reserves the built-in Admin name', () => {
  assert.ok(aliasNameError(ADMIN_ALIAS_NAME, []))
  assert.ok(aliasNameError(ADMIN_ALIAS_NAME.toLowerCase(), []))
  // …unless it IS Admin being left alone, which a no-op rename would be.
  assert.equal(aliasNameError(ADMIN_ALIAS_NAME, [ADMIN_ALIAS_NAME], ADMIN_ALIAS_NAME), null)
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

// presentation

test('describeAliases lists up to max names, then counts the rest', () => {
  assert.equal(describeAliases([]), 'None')
  assert.equal(describeAliases(['Admin']), 'Admin')
  assert.equal(describeAliases(['Admin', 'Eng', 'Board']), 'Admin, Eng, Board')
  assert.equal(describeAliases(['Admin', 'Eng', 'Board', 'GTM']), 'Admin, Eng, Board +1')
  assert.equal(describeAliases(['Admin', 'Eng', 'Board', 'GTM'], 2), 'Admin, Eng +2')
})

// identity — an alias is its id, not its name

test('summarize pairs holders by alias id, not by name', () => {
  const aliases: SpaceAlias[] = [
    { id: 'al_1', name: 'Founder', color: '#000', nodeType: 'Person' },
    { id: 'al_2', name: 'Investor', color: '#000', nodeType: 'Person' },
  ]
  const holders = [
    { aliasId: 'al_1', userId: 'u-1' },
    { aliasId: 'al_2', userId: 'u-2' },
  ]
  const summaries = summarize(aliases, holders)
  assert.deepEqual(summaries.map((s) => s.holderIds), [['u-1'], ['u-2']])
})

test('a rename does not move holders — the id they hold has not changed', () => {
  const holders = [{ aliasId: 'al_1', userId: 'u-1' }]
  const before = summarize([{ id: 'al_1', name: 'Founder', color: '#000', nodeType: 'Person' }], holders)
  const after = summarize([{ id: 'al_1', name: 'Operator', color: '#000', nodeType: 'Person' }], holders)
  assert.deepEqual(before[0].holderIds, ['u-1'])
  assert.deepEqual(after[0].holderIds, ['u-1'])
})

test('a holder row pointing at a deleted alias attaches to nothing', () => {
  const summaries = summarize(
    [{ id: 'al_1', name: 'Founder', color: '#000', nodeType: 'Person' }],
    [{ aliasId: 'al_gone', userId: 'u-1' }],
  )
  assert.deepEqual(summaries[0].holderIds, [])
})

const VOCABULARY: SpaceAlias[] = [
  { id: 'admin', name: 'Admin', color: '#b4881b', nodeType: 'Person', admin: true, system: true },
  { id: 'al_1', name: 'Founder', color: '#16a34a', nodeType: 'Person' },
  { id: 'al_2', name: 'Portfolio', color: '#0891b2', nodeType: 'Space' },
]

test('findAliasByRef resolves by id', () => {
  assert.equal(findAliasByRef(VOCABULARY, 'al_1')?.name, 'Founder')
})

test('findAliasByRef resolves by name, ignoring case and padding', () => {
  // The MCP add_context bug: `founder` was validated case-insensitively and then
  // stored verbatim, so every exact-match read afterwards missed it.
  assert.equal(findAliasByRef(VOCABULARY, 'founder')?.id, 'al_1')
  assert.equal(findAliasByRef(VOCABULARY, '  FOUNDER  ')?.id, 'al_1')
})

test('findAliasByRef returns the CANONICAL name, whatever casing came in', () => {
  assert.equal(findAliasByRef(VOCABULARY, 'fOuNdEr')?.name, 'Founder')
})

test('findAliasByRef scopes to a node type when asked', () => {
  assert.equal(findAliasByRef(VOCABULARY, 'Portfolio', 'Space')?.id, 'al_2')
  assert.equal(findAliasByRef(VOCABULARY, 'Portfolio', 'Person'), undefined)
  assert.equal(findAliasByRef(VOCABULARY, 'Founder', 'Space'), undefined)
})

test('findAliasByRef finds the built-in Admin, stored or not', () => {
  assert.equal(findAliasByRef(VOCABULARY, ADMIN_ALIAS_ID, 'Person')?.name, 'Admin')
  // A space that never stored Admin still resolves it — personAliases grafts it.
  assert.equal(findAliasByRef(personAliases([]), ADMIN_ALIAS_ID, 'Person')?.id, ADMIN_ALIAS_ID)
  assert.equal(findAliasByRef(personAliases([]), 'admin', 'Person')?.name, 'Admin')
})

test('findAliasByRef is empty-safe', () => {
  assert.equal(findAliasByRef(VOCABULARY, null), undefined)
  assert.equal(findAliasByRef(VOCABULARY, ''), undefined)
  assert.equal(findAliasByRef(undefined, 'Founder'), undefined)
  assert.equal(findAliasByRef(VOCABULARY, 'Nope'), undefined)
})

test('personAliases pins Admin to its reserved id even if storage says otherwise', () => {
  const grafted = personAliases([
    { id: 'al_wrong', name: 'Admin', color: '#b4881b', nodeType: 'Person', admin: true, system: true },
  ])
  assert.equal(grafted[0].id, ADMIN_ALIAS_ID)
})

test('selfJoinAliases never offers an admin alias', () => {
  const offered = selfJoinAliases([
    ...VOCABULARY,
    { id: 'al_3', name: 'Owner', color: '#b4881b', nodeType: 'Person', admin: true },
  ]).map((a) => a.name)
  // Founder only: the built-in Admin, the space's own admin alias and the
  // Space-scoped one are all out.
  assert.deepEqual(offered, ['Founder'])
})

test('selfJoinAliases is empty when the space only administers', () => {
  // personAliases grafts Admin in, so the naive Person list is never empty —
  // this is what makes the join picker skip itself rather than show Admin.
  assert.deepEqual(selfJoinAliases([]), [])
  assert.deepEqual(selfJoinAliases(undefined), [])
})
