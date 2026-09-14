// Unit tests for the pure half of the space's nightly clean
// (lib/notes/shared/cleanSchedule.ts): what a schedule may say, where one may
// exist, and when it next fires. The rules that keep an unattended pass inside
// the space that owns the notes live here.
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/clean-schedule.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CLEAN_FIX_KINDS,
  cleanScheduleDenial,
  describeCleanSchedule,
  effectiveFixKinds,
  embedAfterCleanStatus,
  MAX_CLEANS_PER_TICK,
  nextCleanRunAt,
  normalizeCleanTarget,
  POST_CLEAN_EMBED_NOTES,
  sanitizeCleanSchedule,
  WORKLIST_ITEMS_KEPT,
} from '../lib/notes/shared/cleanSchedule'
import { buildCleanScope } from '../lib/notes/shared/clean'

test('a sub-space and a personal space hold no schedule', () => {
  assert.equal(cleanScheduleDenial({ parentId: null, personalOwnerId: null }), null)
  assert.match(cleanScheduleDenial({ parentId: 'parent' }) ?? '', /sub-space/)
  assert.match(cleanScheduleDenial({ personalOwnerId: 'user_1' }) ?? '', /personal space/)
})

test('a sub-space folder is never in a clean scope, even targeted by hand', () => {
  const scope = buildCleanScope({ role: 'admin', canWrite: () => true })
  assert.equal(scope.inScope('people/craig/index.md'), true)
  assert.equal(scope.inScope('subspaces/team-x/notes/a.md'), false)
  assert.equal(normalizeCleanTarget('subspaces/team-x'), null)
  assert.equal(normalizeCleanTarget('/deals/'), 'deals')
})

test('sanitize clamps the clock and refuses fix kinds it does not own', () => {
  const s = sanitizeCleanSchedule({
    enabled: true,
    hour: 99,
    minute: -1,
    mode: 'sideways',
    targetPath: ' /deals/ ',
    fixKinds: ['setStale', 'deleteEverything'],
  })
  assert.equal(s.hour, 3)
  assert.equal(s.minute, 30)
  assert.equal(s.mode, 'light')
  assert.equal(s.targetPath, 'deals')
  assert.deepEqual(s.fixKinds, ['setStale'])
})

test('no fix kinds means every safe kind; applyFixes off means none', () => {
  assert.equal(effectiveFixKinds({ applyFixes: true, fixKinds: [] }).length, CLEAN_FIX_KINDS.length)
  assert.deepEqual(effectiveFixKinds({ applyFixes: true, fixKinds: ['setStale'] }), ['setStale'])
  assert.deepEqual(effectiveFixKinds({ applyFixes: false, fixKinds: ['setStale'] }), [])
})

test('the next run is the next occurrence in the space zone, never a backfill', () => {
  const settings = { hour: 3, minute: 30 }
  // 2026-03-01T00:00Z is 13:00 in Auckland — 3:30am has passed, so tomorrow.
  const next = nextCleanRunAt(settings, new Date('2026-03-01T00:00:00Z'), 'Pacific/Auckland')
  assert.equal(next.toISOString(), '2026-03-01T14:30:00.000Z')
  assert.ok(next.getTime() > Date.parse('2026-03-01T00:00:00Z'))
  // No zone = UTC.
  assert.equal(
    nextCleanRunAt(settings, new Date('2026-03-01T00:00:00Z'), null).toISOString(),
    '2026-03-01T03:30:00.000Z',
  )
})

test('the schedule describes itself the same way everywhere', () => {
  assert.equal(describeCleanSchedule({ hour: 3, minute: 30 }, 'Pacific/Auckland'), '3:30am each night (Pacific/Auckland)')
  assert.equal(describeCleanSchedule({ hour: 0, minute: 0 }, null), '12:00am each night (UTC)')
})

test('embedding toggles default on, and a patch keeps what it did not send', () => {
  const s = sanitizeCleanSchedule({})
  assert.equal(s.embedEnabled, true)
  assert.equal(s.embedAfterClean, true)
  const off = sanitizeCleanSchedule({ ...s, embedEnabled: false })
  assert.equal(off.embedEnabled, false)
  assert.equal(off.embedAfterClean, true)
})

test('the post-clean embed decides by toggle first, then the key', () => {
  assert.deepEqual(embedAfterCleanStatus({ embedEnabled: false, embedAfterClean: true }, true), { embed: false, status: 'off' })
  assert.deepEqual(embedAfterCleanStatus({ embedEnabled: true, embedAfterClean: false }, true), { embed: false, status: 'skipped' })
  assert.deepEqual(embedAfterCleanStatus({ embedEnabled: true, embedAfterClean: true }, false), { embed: false, status: 'no-key' })
  assert.deepEqual(embedAfterCleanStatus({ embedEnabled: true, embedAfterClean: true }, true), { embed: true, status: 'succeeded' })
})

test('one tick is bounded, and the bound is small enough for the tick budget', () => {
  assert.ok(MAX_CLEANS_PER_TICK >= 1 && MAX_CLEANS_PER_TICK <= 10)
  assert.ok(POST_CLEAN_EMBED_NOTES <= 1000)
  assert.ok(WORKLIST_ITEMS_KEPT >= 10)
})
