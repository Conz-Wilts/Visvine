/**
 * The bridge's two throttles.
 *
 * Both are pure enough to test exactly: the rate limiter takes `now` as an
 * argument, and the concurrency gate is a counter. What matters here is that
 * they hold at the boundary (the 120th call, the 2nd data run) and that they
 * recover — a limiter that refuses forever is worse than none, because a Tool
 * that hits it once would stay broken until the process restarted.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DATA_CALL_CONCURRENCY,
  RATE_WINDOW_MS,
  acquireDataCall,
  bridgeRateKey,
  dataCallsInFlight,
  resetBridgeLimits,
  takeBridgeCall,
} from '@/lib/tools/limits'
import { BRIDGE_LIMITS } from '@/lib/tools/protocol'

test.beforeEach(() => resetBridgeLimits())

// ── keys ──────────────────────────────────────────────────────────────────────

test('the rate key is per viewer AND per install', () => {
  assert.equal(bridgeRateKey('u1', 'i1'), 'u1:i1')
  assert.notEqual(bridgeRateKey('u1', 'i1'), bridgeRateKey('u2', 'i1'))
  assert.notEqual(bridgeRateKey('u1', 'i1'), bridgeRateKey('u1', 'i2'))
})

test('a preview has its own bucket rather than sharing an install id', () => {
  assert.equal(bridgeRateKey('u1', null), 'u1:preview')
})

// ── the sliding window ────────────────────────────────────────────────────────

test('calls up to the limit are allowed and the next one is refused', () => {
  const now = 1_000_000
  for (let i = 0; i < BRIDGE_LIMITS.callsPerMinute; i++) {
    const decision = takeBridgeCall('k', now)
    assert.equal(decision.ok, true, `call ${i + 1} should have been allowed`)
  }
  const refused = takeBridgeCall('k', now)
  assert.equal(refused.ok, false)
})

test('`remaining` counts down to zero over the window', () => {
  const now = 1_000_000
  const first = takeBridgeCall('k', now)
  assert.equal(first.ok && first.remaining, BRIDGE_LIMITS.callsPerMinute - 1)
  for (let i = 1; i < BRIDGE_LIMITS.callsPerMinute; i++) takeBridgeCall('k', now)
  const refused = takeBridgeCall('k', now)
  assert.equal(refused.ok, false)
})

test('retryAfterMs names when the oldest call leaves the window', () => {
  const now = 1_000_000
  takeBridgeCall('k', now, 2)
  takeBridgeCall('k', now + 5_000, 2)
  const refused = takeBridgeCall('k', now + 10_000, 2)
  assert.equal(refused.ok, false)
  // The first call (at `now`) expires a full window after it was made.
  assert.equal(refused.ok === false && refused.retryAfterMs, RATE_WINDOW_MS - 10_000)
})

test('the window slides — an expired call frees its slot', () => {
  const now = 1_000_000
  takeBridgeCall('k', now, 1)
  assert.equal(takeBridgeCall('k', now + 1, 1).ok, false)
  assert.equal(takeBridgeCall('k', now + RATE_WINDOW_MS + 1, 1).ok, true)
})

test('a refused call does not itself consume budget', () => {
  const now = 1_000_000
  takeBridgeCall('k', now, 1)
  // Hammering while refused must not push the recovery time out.
  for (let i = 0; i < 50; i++) takeBridgeCall('k', now + 1_000, 1)
  assert.equal(takeBridgeCall('k', now + RATE_WINDOW_MS + 1, 1).ok, true)
})

test('buckets are independent', () => {
  const now = 1_000_000
  takeBridgeCall('a', now, 1)
  assert.equal(takeBridgeCall('a', now, 1).ok, false)
  assert.equal(takeBridgeCall('b', now, 1).ok, true)
})

// ── data.call concurrency ─────────────────────────────────────────────────────

test('two data calls run at once and the third is refused', () => {
  const first = acquireDataCall('install-1')
  const second = acquireDataCall('install-1')
  assert.ok(first)
  assert.ok(second)
  assert.equal(DATA_CALL_CONCURRENCY, 2)
  assert.equal(acquireDataCall('install-1'), null)
  assert.equal(dataCallsInFlight('install-1'), 2)

  first()
  assert.equal(dataCallsInFlight('install-1'), 1)
  assert.ok(acquireDataCall('install-1'), 'a released slot must be reusable')
  second()
})

test('releasing twice cannot free a slot that was never taken', () => {
  const release = acquireDataCall('install-1')
  assert.ok(release)
  release()
  release()
  release()
  assert.equal(dataCallsInFlight('install-1'), 0)
  // Still exactly two available, not three.
  assert.ok(acquireDataCall('install-1'))
  assert.ok(acquireDataCall('install-1'))
  assert.equal(acquireDataCall('install-1'), null)
})

test('the cap is per install, not global', () => {
  assert.ok(acquireDataCall('install-1'))
  assert.ok(acquireDataCall('install-1'))
  assert.equal(acquireDataCall('install-1'), null)
  assert.ok(acquireDataCall('install-2'), 'another install has its own pair of slots')
})
