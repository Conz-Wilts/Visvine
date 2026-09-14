// Tools flowing down into a house's rooms (lib/tools/share.ts): the plan the
// sync derives from the note's `share:` and the rows that exist. Pure — no
// database. Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-share.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { sharedInstallPlan } from '@/lib/tools/share'

const H = 'house'
const rooms = ['a', 'b', 'c']

test('share: all installs into every room that has no row, and updates a shared row on a stale version', () => {
  const plan = sharedInstallPlan({
    houseId: H,
    targets: 'all',
    rooms,
    versionId: 'v2',
    existing: [{ spaceId: 'b', sharedFromSpaceId: H, versionId: 'v1' }],
  })
  assert.deepEqual(plan, { create: ['a', 'c'], update: ['b'], remove: [] })
})

test('a named list reaches those rooms only, and takes back what it no longer names', () => {
  const plan = sharedInstallPlan({
    houseId: H,
    targets: ['a'],
    rooms,
    versionId: 'v2',
    existing: [
      { spaceId: 'a', sharedFromSpaceId: H, versionId: 'v2' },
      { spaceId: 'b', sharedFromSpaceId: H, versionId: 'v2' },
    ],
  })
  assert.deepEqual(plan, { create: [], update: [], remove: ['b'] })
})

test("a room's own install is never touched, whatever the house shares", () => {
  const own = { spaceId: 'a', sharedFromSpaceId: null, versionId: 'v1' }
  assert.deepEqual(
    sharedInstallPlan({ houseId: H, targets: 'all', rooms: ['a'], versionId: 'v2', existing: [own] }),
    { create: [], update: [], remove: [] },
  )
  assert.deepEqual(
    sharedInstallPlan({ houseId: H, targets: 'none', rooms: ['a'], versionId: 'v2', existing: [own] }),
    { create: [], update: [], remove: [] },
  )
})

test('share: none, or no version to run, removes every shared row and installs nothing', () => {
  const existing = [{ spaceId: 'a', sharedFromSpaceId: H, versionId: 'v1' }]
  assert.deepEqual(
    sharedInstallPlan({ houseId: H, targets: 'none', rooms, versionId: 'v1', existing }),
    { create: [], update: [], remove: ['a'] },
  )
  assert.deepEqual(
    sharedInstallPlan({ houseId: H, targets: 'all', rooms, versionId: null, existing }),
    { create: [], update: [], remove: ['a'] },
  )
})

test('a shared row from some OTHER house is not this house\'s to remove', () => {
  const plan = sharedInstallPlan({
    houseId: H,
    targets: 'none',
    rooms: ['a'],
    versionId: 'v1',
    existing: [{ spaceId: 'a', sharedFromSpaceId: 'elsewhere', versionId: 'v1' }],
  })
  assert.deepEqual(plan, { create: [], update: [], remove: [] })
})
