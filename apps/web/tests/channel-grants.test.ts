// A channel as a grant subject: its members read what it is granted, and a
// resource or private channel whose note is out of reach is out of sight.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectiveLevel, LEVEL_EDIT, LEVEL_VIEW, winningGrant, type ContextAccess } from '../lib/notes/shared/authz'
import { audienceSummary } from '../lib/notes/shared/audience'
import { reachFor } from '../lib/notes/shared/memberAccess'
import { isEntityHidden, withoutHiddenEntities } from '../lib/notes/shared/entityVisibility'

const everyone = { subjectType: 'space' as const, subjectId: '', resourcePath: '', level: LEVEL_EDIT }
const board = { subjectType: 'channel' as const, subjectId: 'board', resourcePath: 'resources/q3-plan', level: LEVEL_VIEW }

/** A member's pre-scoped access: the loader only hands over their channels' grants. */
function access(inBoard: boolean): ContextAccess {
  return { grants: inBoard ? [everyone, board] : [everyone], restricted: ['resources/q3-plan'], locked: [] }
}

test('a restricted resource folder is read by its channel’s members only', () => {
  assert.equal(effectiveLevel(access(true), 'resources/q3-plan/index.md'), LEVEL_VIEW)
  assert.equal(effectiveLevel(access(false), 'resources/q3-plan/index.md'), 0)
  assert.equal(effectiveLevel(access(false), 'resources/other/index.md'), LEVEL_EDIT)
})

test('a channel grant is more specific than everyone, less than a person', () => {
  const person = { ...board, subjectType: 'user' as const, subjectId: 'ana' }
  assert.equal(winningGrant([board, { ...everyone, resourcePath: 'resources/q3-plan', level: LEVEL_VIEW }], 'resources/q3-plan', [])?.subjectType, 'channel')
  assert.equal(winningGrant([board, person], 'resources/q3-plan', [])?.subjectType, 'user')
})

test('the audience line counts channels, never names members', () => {
  const summary = audienceSummary('resources/q3-plan/index.md', [everyone, board], ['resources/q3-plan'], {
    selfUserId: 'ana',
  })
  assert.equal(summary.line, 'restricted — members of 1 channel + admins')
})

test('a member’s console reach leaves channel grants out', () => {
  const reach = reachFor([everyone, board], { userId: 'ana', aliases: [] })
  assert.deepEqual(reach.map((r) => r.grant.subjectType), ['space'])
})

test('a resource or channel node out of reach is hidden; other kinds never are', () => {
  const file = { id: 'resource:q3-plan', type: 'resource' }
  const person = { id: 'person:q3-plan', type: 'person' }
  assert.equal(isEntityHidden(file, access(false)), true)
  assert.equal(isEntityHidden(file, access(true)), false)
  assert.equal(isEntityHidden(person, { ...access(false), restricted: ['people/q3-plan'] }), false)
  assert.deepEqual(withoutHiddenEntities([file, person], access(false)).map((n) => n.id), ['person:q3-plan'])
  assert.equal(withoutHiddenEntities([file], null).length, 1)
})
