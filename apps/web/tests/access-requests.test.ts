// Unit tests for the pure access-request rules (lib/notes/shared/accessRequests.ts):
// who may file a request, who may see or resolve one in a queue, and how it reads.
// The DB side (lib/notes/accessRequests.ts) is a thin wrapper over these plus
// grantAccess, which brain-permissions.test.ts already covers.
// Run: node --import tsx --test tests/access-requests.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  canRequest,
  canResolveRequest,
  describeOutcome,
  describeRequest,
  requestTargetLabel,
  requestVisibleTo,
  sortRequests,
} from '../lib/notes/shared/accessRequests'
import { LEVEL_EDIT, LEVEL_FULL, LEVEL_VIEW, type AccessGrant, type BrainAccess } from '../lib/notes/shared/authz'
import type { AccessRequest, BrainPrincipal } from '../lib/notes/shared/brainTypes'

// fixtures

const grant = (resourcePath: string, level: number, userId = 'u-me'): AccessGrant => ({
  subjectType: 'user',
  subjectId: userId,
  resourcePath,
  level,
})

const access = (grants: AccessGrant[], restricted: string[] = []): BrainAccess => ({
  grants,
  restricted,
  locked: [],
})

const principal = (userId: string, acc: BrainAccess, over: Partial<BrainPrincipal> = {}): BrainPrincipal => ({
  userId,
  email: `${userId}@x.test`,
  name: userId,
  spaceId: 'c1',
  spaceAdmin: false,
  access: acc,
  ...over,
})

const request = (over: Partial<AccessRequest> = {}): AccessRequest => ({
  id: 'r1',
  resourcePath: '',
  userId: 'u-them',
  level: LEVEL_VIEW,
  requestedAt: 1_000,
  status: 'pending',
  ...over,
})

// filing

test('canRequest: only refused when the caller can already read the path', () => {
  const gated = principal('u-me', access([]))
  assert.equal(canRequest(gated, ''), true)
  assert.equal(canRequest(gated, 'teams/engineering/oncall.md'), true)

  const reader = principal('u-me', access([grant('', LEVEL_VIEW)]))
  assert.equal(canRequest(reader, ''), false)
  assert.equal(canRequest(reader, 'strategy/2026.md'), false)
})

test('canRequest: a restricted folder is requestable by someone the cut excludes', () => {
  // Root grant, but 'teams/engineering' is a boundary they hold nothing on.
  const outside = principal('u-me', access([grant('', LEVEL_EDIT)], ['teams/engineering']))
  assert.equal(canRequest(outside, 'teams/engineering/oncall.md'), true)
  assert.equal(canRequest(outside, 'strategy/2026.md'), false)

  // A grant ON the boundary reaches inside, so there's nothing left to ask for.
  const inside = principal(
    'u-me',
    access([grant('', LEVEL_EDIT), grant('teams/engineering', LEVEL_VIEW)], ['teams/engineering']),
  )
  assert.equal(canRequest(inside, 'teams/engineering/oncall.md'), false)
})

test('canRequest: a path that does not exist is still requestable', () => {
  // Deliberate: readVisible 404s hidden and absent notes identically, so
  // refusing an unknown path would tell the caller which one it is.
  const gated = principal('u-me', access([]))
  assert.equal(canRequest(gated, 'nothing/here.md'), true)
})

// seeing and resolving

test('requestVisibleTo: your own request, plus anything you manage', () => {
  const mine = request({ userId: 'u-me', resourcePath: 'deals' })
  const theirs = request({ userId: 'u-them', resourcePath: 'deals' })

  // No standing anywhere: own only.
  const plain = principal('u-me', access([grant('deals', LEVEL_VIEW)]))
  assert.equal(requestVisibleTo(plain, mine), true)
  assert.equal(requestVisibleTo(plain, theirs), false)

  // Full access at an ANCESTOR manages the path below it.
  const manager = principal('u-me', access([grant('', LEVEL_FULL)]))
  assert.equal(requestVisibleTo(manager, theirs), true)

  // Space admins manage everything, including the root gate.
  const admin = principal('u-admin', access([]), { spaceAdmin: true })
  assert.equal(requestVisibleTo(admin, request({ resourcePath: '' })), true)
  assert.equal(requestVisibleTo(admin, request({ resourcePath: 'teams/engineering' })), true)
})

test('canResolveRequest: manage standing only — filing your own does not qualify', () => {
  const mine = request({ userId: 'u-me', resourcePath: 'deals' })
  assert.equal(canResolveRequest(principal('u-me', access([])), mine), false)
  assert.equal(canResolveRequest(principal('u-me', access([grant('deals', LEVEL_EDIT)])), mine), false)
  assert.equal(canResolveRequest(principal('u-me', access([grant('deals', LEVEL_FULL)])), mine), true)
})

test('canResolveRequest: a restricted boundary cuts manage standing too', () => {
  const deep = request({ resourcePath: 'teams/engineering/oncall.md' })
  const rootFull = principal('u-me', access([grant('', LEVEL_FULL)], ['teams/engineering']))
  assert.equal(canResolveRequest(rootFull, deep), false)
  const onBoundary = principal(
    'u-me',
    access([grant('teams/engineering', LEVEL_FULL)], ['teams/engineering']),
  )
  assert.equal(canResolveRequest(onBoundary, deep), true)
})

// presentation

test('requestTargetLabel: the root reads as the context name; notes drop .md', () => {
  assert.equal(requestTargetLabel('', 'Blackbird context'), 'Blackbird context')
  assert.equal(requestTargetLabel('deals', 'Ctx'), 'deals')
  assert.equal(requestTargetLabel('deals/canva.md', 'Ctx'), 'deals/canva')
})

test('describeOutcome: an approval reports the level GRANTED, not the one asked for', () => {
  const approved = request({
    resourcePath: 'meetings/sync.md',
    level: LEVEL_VIEW,
    status: 'approved',
    grantedLevel: LEVEL_EDIT,
  })
  assert.equal(describeOutcome(approved, 'Ctx'), 'Editor on meetings/sync')
  // Older rows with no grantedLevel fall back to the requested level.
  assert.equal(
    describeOutcome({ ...approved, grantedLevel: undefined }, 'Ctx'),
    'Viewer on meetings/sync',
  )
  // A denial hands out no level, so it names only the resource.
  assert.equal(describeOutcome(request({ status: 'denied' }), 'Space context'), 'Space context')
})

test('describeRequest: names the level asked for and the target', () => {
  assert.equal(
    describeRequest(request({ resourcePath: 'deals/canva.md', level: LEVEL_VIEW }), 'Ctx'),
    'wants Viewer on deals/canva',
  )
  assert.equal(
    describeRequest(request({ resourcePath: '', level: LEVEL_EDIT }), 'Space context'),
    'wants Editor on Space context',
  )
})

test('sortRequests: pending first, then newest first', () => {
  const rows = [
    request({ id: 'old-pending', status: 'pending', requestedAt: 1 }),
    request({ id: 'new-approved', status: 'approved', requestedAt: 9 }),
    request({ id: 'new-pending', status: 'pending', requestedAt: 5 }),
    request({ id: 'old-denied', status: 'denied', requestedAt: 2 }),
  ]
  assert.deepEqual(
    sortRequests(rows).map((r) => r.id),
    ['new-pending', 'old-pending', 'new-approved', 'old-denied'],
  )
  // Non-mutating — the queue UI memoizes off the original array.
  assert.equal(rows[0].id, 'old-pending')
})
