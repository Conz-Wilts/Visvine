/**
 * Per-space connector quotas (lib/connectors/quota.ts): the sliding window
 * and the concurrency cap, driven with an explicit clock.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  acquireConnectorRun,
  CONNECTOR_CONCURRENCY,
  CONNECTOR_RATE_WINDOW_MS,
  connectorRunsInFlight,
  connectorRunsPerMinute,
  resetConnectorQuota,
  takeConnectorRun,
} from '@/lib/connectors/quota'

test.beforeEach(() => resetConnectorQuota())

test('the window admits `limit` runs, refuses the next, and names when to retry', () => {
  const t0 = 1_000_000
  for (let i = 0; i < 3; i++) {
    const d = takeConnectorRun('space-a', t0 + i, 3)
    assert.equal(d.ok, true)
    if (d.ok) assert.equal(d.remaining, 2 - i)
  }
  const refused = takeConnectorRun('space-a', t0 + 10, 3)
  assert.equal(refused.ok, false)
  if (!refused.ok) assert.equal(refused.retryAfterMs, CONNECTOR_RATE_WINDOW_MS - 10)
})

test('runs fall out of the window after a minute, one at a time', () => {
  const t0 = 5_000_000
  takeConnectorRun('s', t0, 2)
  takeConnectorRun('s', t0 + 500, 2)
  assert.equal(takeConnectorRun('s', t0 + 1_000, 2).ok, false)
  // The first run leaves the window exactly one window later.
  assert.equal(takeConnectorRun('s', t0 + CONNECTOR_RATE_WINDOW_MS + 1, 2).ok, true)
  // The second is still inside; the window is full again.
  assert.equal(takeConnectorRun('s', t0 + CONNECTOR_RATE_WINDOW_MS + 2, 2).ok, false)
})

test('spaces do not share a window', () => {
  const t0 = 42
  takeConnectorRun('a', t0, 1)
  assert.equal(takeConnectorRun('a', t0 + 1, 1).ok, false)
  assert.equal(takeConnectorRun('b', t0 + 1, 1).ok, true)
})

test('the default budget is 120/min unless CONNECTOR_RUNS_PER_MINUTE overrides it', () => {
  const prior = process.env.CONNECTOR_RUNS_PER_MINUTE
  try {
    delete process.env.CONNECTOR_RUNS_PER_MINUTE
    assert.equal(connectorRunsPerMinute(), 120)
    process.env.CONNECTOR_RUNS_PER_MINUTE = '7'
    assert.equal(connectorRunsPerMinute(), 7)
    process.env.CONNECTOR_RUNS_PER_MINUTE = 'lots'
    assert.equal(connectorRunsPerMinute(), 120)
    process.env.CONNECTOR_RUNS_PER_MINUTE = '0'
    assert.equal(connectorRunsPerMinute(), 120)
  } finally {
    if (prior === undefined) delete process.env.CONNECTOR_RUNS_PER_MINUTE
    else process.env.CONNECTOR_RUNS_PER_MINUTE = prior
  }
})

test('concurrency: two slots per space, refused past that, released idempotently', () => {
  assert.equal(CONNECTOR_CONCURRENCY, 2)
  const a = acquireConnectorRun('s')
  const b = acquireConnectorRun('s')
  assert.ok(a && b)
  assert.equal(acquireConnectorRun('s'), null)
  assert.equal(connectorRunsInFlight('s'), 2)
  // Another space is unaffected.
  assert.ok(acquireConnectorRun('other'))
  a!()
  a!()
  assert.equal(connectorRunsInFlight('s'), 1)
  assert.ok(acquireConnectorRun('s'))
  b!()
  assert.equal(connectorRunsInFlight('s'), 1)
})
