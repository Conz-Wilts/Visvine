import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accessSummary, reachFor } from '../lib/notes/shared/memberAccess'
import { LEVEL_EDIT, LEVEL_VIEW, type AccessGrant } from '../lib/notes/shared/authz'

const research = { id: 'alias-research', name: 'Research', color: '#123456' }
const ops = { id: 'alias-ops', name: 'Ops', color: '#654321' }

const grants: AccessGrant[] = [
  { subjectType: 'user', subjectId: 'alice', resourcePath: 'handbook.md', level: LEVEL_EDIT },
  { subjectType: 'alias', subjectId: ops.id, resourcePath: 'ops', level: LEVEL_EDIT },
  { subjectType: 'alias', subjectId: research.id, resourcePath: 'research', level: LEVEL_VIEW },
  { subjectType: 'space', subjectId: '', resourcePath: 'public', level: LEVEL_VIEW },
  { subjectType: 'user', subjectId: 'bob', resourcePath: '', level: LEVEL_EDIT },
]

test('reachFor keeps only what applies, ordered everyone → alias → direct', () => {
  const reach = reachFor(grants, { userId: 'alice', aliases: [research] })
  assert.deepEqual(
    reach.map((r) => [r.via.kind, r.grant.resourcePath]),
    [
      ['everyone', 'public'],
      ['alias', 'research'],
      ['direct', 'handbook.md'],
    ],
  )
  const viaAlias = reach[1].via
  assert.equal(viaAlias.kind === 'alias' && viaAlias.name, 'Research')
})

test('accessSummary: the root wins, else a count of places, else nothing', () => {
  assert.equal(accessSummary(grants, { userId: 'bob', aliases: [] }, []).label, 'Editor of everything')
  assert.equal(
    accessSummary(grants, { userId: 'alice', aliases: [research] }, []).label,
    'Editor in 3 places',
  )
  assert.equal(accessSummary(grants, { userId: 'carol', aliases: [] }, []).label, 'Viewer in 1 place')
  assert.equal(accessSummary([], { userId: 'carol', aliases: [] }, []).label, 'No access')
})

test('accessSummary respects a restricted cut at the root', () => {
  const rootView: AccessGrant[] = [
    { subjectType: 'space', subjectId: '', resourcePath: '', level: LEVEL_VIEW },
  ]
  assert.equal(accessSummary(rootView, { userId: 'x', aliases: [] }, ['secret']).label, 'Viewer of everything')
})
