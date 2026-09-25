/**
 * The bridge's two throttles:
 *
 *   • a rate limit on every bridge call, per viewer per target;
 *   • a concurrency cap on `data.call`, per target.
 *
 * Both are ROWS (`takeBridgeCallShared`, `acquireDataCallShared`): the runtime
 * is N instances, and a per-process limiter there is N limits, each reset by a
 * cold start. The rate is a token bucket in `rate_limit_buckets`
 * (lib/rateLimit), the cap a lease in `rate_limit_leases`
 * (lib/rateLimit/leases.ts). What they buy is that one Tool in a loop cannot
 * make the app unusable for the person running it, and that `data.call` cannot
 * take all four isolate slots (lib/connectors/isolate.ts) away from connectors
 * and agents. The hard guarantees (perimeter, viewer grants, byte caps, isolate
 * timeouts) are per call and hold on every instance regardless.
 *
 * The in-process versions below are the fallback when the store is
 * unreachable — a weaker limit, never none — and are pure enough to test
 * exactly: `now` is a parameter rather than a read of the clock.
 */
import { takeToken } from '@/lib/rateLimit'
import { acquireLease } from '@/lib/rateLimit/leases'
import { logger } from '@/lib/logger'
import { BRIDGE_LIMITS } from './protocol'

/** The sliding window the call budget is measured over. */
export const RATE_WINDOW_MS = 60_000

/**
 * Concurrent `data.call` runs allowed per install.
 *
 * Two, against the isolate's own MAX_CONCURRENT_RUNS of 4: a Tool may overlap a
 * pair of handlers (a list and its counts, say) and still leave half the runtime
 * for the connectors and agents that share it.
 */
export const DATA_CALL_CONCURRENCY = 2

/**
 * How many distinct rate buckets are kept before idle ones are swept. Buckets
 * are tiny (a viewer id and a few timestamps) and a sweep is O(size), so this is
 * about never growing without bound in a long-lived process, not about memory
 * pressure at any realistic scale.
 */
const MAX_TRACKED_KEYS = 5_000

/**
 * The bucket key: a viewer's budget is per TARGET, not per space — pass
 * `targetKey(resolved)` from lib/tools/target.ts, which is the install id for an
 * install and `preview:<space>/<name>` for a preview. Keying previews on the
 * bare word "preview" would give every draft one author is working on a single
 * shared budget, so one chatty draft would rate-limit all the others.
 */
export function bridgeRateKey(viewerId: string, targetKey: string): string {
  return `${viewerId}:${targetKey}`
}

export type RateDecision = { ok: true; remaining: number } | { ok: false; retryAfterMs: number }

/** Call timestamps per key, oldest first (a call is only ever appended). */
const calls = new Map<string, number[]>()

/** Drop everything that fell out of the window; returns what's left. */
function windowOf(key: string, now: number): number[] {
  const hits = calls.get(key)
  if (!hits) return []
  const cutoff = now - RATE_WINDOW_MS
  // Timestamps are appended in order, so the survivors are always a suffix.
  let drop = 0
  while (drop < hits.length && hits[drop] <= cutoff) drop++
  return drop === 0 ? hits : hits.slice(drop)
}

/** Forget every bucket that has gone quiet for a whole window. */
function sweep(now: number): void {
  for (const key of [...calls.keys()]) {
    const live = windowOf(key, now)
    if (live.length === 0) calls.delete(key)
    else calls.set(key, live)
  }
}

/**
 * Take one call's worth of budget. On refusal, `retryAfterMs` is when the
 * oldest call in the window falls out of it — the earliest moment the next call
 * could succeed, so a Tool that honours it stops hammering.
 */
export function takeBridgeCall(
  key: string,
  now: number = Date.now(),
  limit: number = BRIDGE_LIMITS.callsPerMinute,
): RateDecision {
  if (calls.size > MAX_TRACKED_KEYS) sweep(now)
  const live = windowOf(key, now)
  if (live.length >= limit) {
    calls.set(key, live)
    return { ok: false, retryAfterMs: Math.max(1, live[0] + RATE_WINDOW_MS - now) }
  }
  live.push(now)
  calls.set(key, live)
  return { ok: true, remaining: limit - live.length }
}

/** Live counts per install key. Absent means zero — never a stored 0. */
const running = new Map<string, number>()

/**
 * Take a `data.call` slot, or null when this install is already at the cap.
 *
 * Refuses rather than queues, unlike the isolate's own gate: a queued bridge
 * call holds an HTTP request open behind a run that may take the full 20s, and
 * a Tool told `rate_limited` now can retry, which is the better failure.
 *
 * The returned release is idempotent, so a `finally` that runs twice (or after a
 * throw that already released) cannot drive the count negative.
 */
export function acquireDataCall(
  key: string,
  cap: number = DATA_CALL_CONCURRENCY,
): (() => void) | null {
  const current = running.get(key) ?? 0
  if (current >= cap) return null
  running.set(key, current + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const next = (running.get(key) ?? 1) - 1
    if (next <= 0) running.delete(key)
    else running.set(key, next)
  }
}

/** Live `data.call` count for a key — for tests and for a future health surface. */
export function dataCallsInFlight(key: string): number {
  return running.get(key) ?? 0
}

/**
 * How long a `data.call` slot is held at most: the isolate's own timeout plus
 * room for the round trip, so a holder that died mid-call frees its slot.
 */
const DATA_CALL_LEASE_MS = 30_000

/**
 * Spend one call from a viewer's budget for one target, shared by every
 * instance. `limit` calls a minute, refilled continuously; a halved limit is
 * how a new listing's reach is staged.
 */
export async function takeBridgeCallShared(
  key: string,
  limit: number = BRIDGE_LIMITS.callsPerMinute,
): Promise<{ ok: true } | { ok: false; retryAfterMs: number }> {
  const result = await takeToken(`tools:bridge:${key}`, {
    capacity: limit,
    refillPerSec: limit / (RATE_WINDOW_MS / 1000),
  })
  return result.ok ? { ok: true } : { ok: false, retryAfterMs: Math.max(1, result.retryAfterMs) }
}

/**
 * Take a `data.call` slot for a target, shared by every instance, or null
 * when it is at the cap. Refuses rather than queues, like the in-process
 * gate. With the store unreachable, the in-process gate decides.
 */
export async function acquireDataCallShared(
  key: string,
  cap: number = DATA_CALL_CONCURRENCY,
): Promise<(() => void) | null> {
  try {
    const lease = await acquireLease(`tools:data:${key}`, cap, DATA_CALL_LEASE_MS)
    return lease ? () => void lease.release() : null
  } catch (err) {
    logger.error('tools.limits.lease_unavailable', { err })
    return acquireDataCall(key, cap)
  }
}

/** Drop all state. Tests only: a shared process must not leak counts between them. */
export function resetBridgeLimits(): void {
  calls.clear()
  running.clear()
}
