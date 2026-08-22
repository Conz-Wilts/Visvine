// Pure scheduling logic behind the nightly maintenance run.
// test runner: node --import tsx --test tests/nightly-schedule.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  msUntilNextRun,
  nightlyDriver,
  nightlyEnabled,
  nightlyRunHour,
} from '../lib/notes/shared/nightly'

const HOUR = 60 * 60 * 1000

test('msUntilNextRun targets today when the hour is still ahead', () => {
  const now = new Date(2026, 7, 12, 1, 0, 0, 0) // 1am local
  assert.equal(msUntilNextRun(now, 3), 2 * HOUR)
})

test('msUntilNextRun rolls to tomorrow when the hour has passed (or is now)', () => {
  const now = new Date(2026, 7, 12, 4, 30, 0, 0)
  assert.equal(msUntilNextRun(now, 3), 22.5 * HOUR)
  const exactly = new Date(2026, 7, 12, 3, 0, 0, 0)
  assert.equal(msUntilNextRun(exactly, 3), 24 * HOUR)
})

test('nightlyEnabled: production default, explicit override wins either way', () => {
  assert.equal(nightlyEnabled({ NODE_ENV: 'production' }), true)
  assert.equal(nightlyEnabled({ NODE_ENV: 'development' }), false)
  assert.equal(
    nightlyEnabled({ NODE_ENV: 'development', NIGHTLY_MAINTENANCE: 'on' }),
    true,
  )
  assert.equal(
    nightlyEnabled({ NODE_ENV: 'production', NIGHTLY_MAINTENANCE: 'off' }),
    false,
  )
})

test('nightlyRunHour: valid 0-23 obeyed, junk falls back to 3', () => {
  assert.equal(nightlyRunHour({ NIGHTLY_MAINTENANCE_HOUR: '0' }), 0)
  assert.equal(nightlyRunHour({ NIGHTLY_MAINTENANCE_HOUR: '23' }), 23)
  assert.equal(nightlyRunHour({ NIGHTLY_MAINTENANCE_HOUR: '24' }), 3)
  assert.equal(nightlyRunHour({ NIGHTLY_MAINTENANCE_HOUR: 'x' }), 3)
  assert.equal(nightlyRunHour({}), 3)
})

test('nightlyDriver: a scale-to-zero runtime never owns the schedule itself', () => {
  // K_SERVICE is set by Cloud Run. An in-process 3am timer there is a sweep
  // that silently never runs — at 3am there is usually no instance holding it —
  // so the driver hands the job to Cloud Scheduler without being configured to.
  assert.equal(nightlyDriver({ NODE_ENV: 'production', K_SERVICE: 'visvine-web' }), 'scheduler')
  // A long-lived server keeps the timer.
  assert.equal(nightlyDriver({ NODE_ENV: 'production' }), 'in-process')
})

test('nightlyDriver: disabled beats everything, explicit beats the guess', () => {
  assert.equal(nightlyDriver({ NODE_ENV: 'production', NIGHTLY_MAINTENANCE: 'off' }), 'off')
  assert.equal(nightlyDriver({ NODE_ENV: 'development' }), 'off')
  assert.equal(
    nightlyDriver({ NODE_ENV: 'development', NIGHTLY_MAINTENANCE: 'on' }),
    'in-process',
  )
  // A Cloud Run service with no scheduler job yet can be told to keep its timer.
  assert.equal(
    nightlyDriver({
      NODE_ENV: 'production',
      K_SERVICE: 'visvine-web',
      NIGHTLY_MAINTENANCE_DRIVER: 'in-process',
    }),
    'in-process',
  )
  // And a long-lived deploy can be told a scheduler owns it.
  assert.equal(
    nightlyDriver({ NODE_ENV: 'production', NIGHTLY_MAINTENANCE_DRIVER: 'scheduler' }),
    'scheduler',
  )
  // Junk falls back to the guess rather than to 'off'.
  assert.equal(
    nightlyDriver({ NODE_ENV: 'production', NIGHTLY_MAINTENANCE_DRIVER: 'cron' }),
    'in-process',
  )
})
