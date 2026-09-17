// Unit tests for the pure half of the space's nightly clean
// (lib/notes/shared/cleanSchedule.ts): what a schedule may say, where one may
// exist, and when it next fires. The rules that keep an unattended pass inside
// the space that owns the notes live here.
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/clean-schedule.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  cleanScheduleDenial,
  embedDecision,
  MAX_CLEANS_PER_TICK,
  nextCleanRunAt,
  POST_CLEAN_EMBED_NOTES,
  sanitizeCleanSchedule,
  scheduleActive,
  WORKLIST_ITEMS_KEPT,
} from '../lib/notes/shared/cleanSchedule'
import { buildCleanScope } from '../lib/notes/shared/clean'

test('a sub-space and a personal space hold no schedule', () => {
  assert.equal(cleanScheduleDenial({ parentId: null, personalOwnerId: null }), null)
  assert.match(cleanScheduleDenial({ parentId: 'parent' }) ?? '', /sub-space/)
  assert.match(cleanScheduleDenial({ personalOwnerId: 'user_1' }) ?? '', /personal space/)
})

test('a sub-space folder is never in a clean scope', () => {
  const scope = buildCleanScope({ role: 'admin', canWrite: () => true })
  assert.equal(scope.inScope('people/craig/index.md'), true)
  assert.equal(scope.inScope('subspaces/team-x/notes/a.md'), false)
})

test('sanitize clamps the clock and keeps only the three settings', () => {
  const s = sanitizeCleanSchedule({ enabled: true, hour: 99, minute: -1, embedEnabled: false })
  assert.deepEqual(s, { enabled: true, hour: 3, minute: 30, embedEnabled: false })
})

test('a schedule fires when clean or embed is on, and not when both are off', () => {
  assert.equal(scheduleActive({ enabled: true, embedEnabled: false }), true)
  assert.equal(scheduleActive({ enabled: false, embedEnabled: true }), true)
  assert.equal(scheduleActive({ enabled: false, embedEnabled: false }), false)
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

test('embedding defaults on, and a patch keeps what it did not send', () => {
  const s = sanitizeCleanSchedule({})
  assert.equal(s.embedEnabled, true)
  assert.equal(s.enabled, false)
  const on = sanitizeCleanSchedule({ ...s, enabled: true })
  assert.equal(on.embedEnabled, true)
})

test('the embed decides by toggle first, then the key', () => {
  assert.deepEqual(embedDecision(false, true), { embed: false, status: 'off' })
  assert.deepEqual(embedDecision(true, false), { embed: false, status: 'no-key' })
  assert.deepEqual(embedDecision(true, true), { embed: true, status: 'succeeded' })
})

test('one tick is bounded, and the bound is small enough for the tick budget', () => {
  assert.ok(MAX_CLEANS_PER_TICK >= 1 && MAX_CLEANS_PER_TICK <= 10)
  assert.ok(POST_CLEAN_EMBED_NOTES <= 1000)
  assert.ok(WORKLIST_ITEMS_KEPT >= 10)
})
