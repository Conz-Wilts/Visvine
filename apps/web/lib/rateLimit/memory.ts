/**
 * The in-process half of the rate limiter: a token bucket in a Map.
 *
 * This is the FALLBACK, not the limiter — `./index.ts` keeps bucket state in
 * Postgres so every instance shares one budget, and drops to this only when the
 * database is unreachable. Its weakness is exactly why it is not the primary
 * path: on a service with N instances it enforces N separate budgets and forgets
 * everything on a cold start. As a degradation that is the right trade (a
 * weaker limit beats refusing traffic because the store is down); as the whole
 * mechanism it is a limit an attacker can walk around by reconnecting.
 */

type Bucket = { tokens: number; updatedAt: number }

declare global {
  var __vvRateBuckets: Map<string, Bucket> | undefined
}

const buckets: Map<string, Bucket> = globalThis.__vvRateBuckets ?? new Map()
if (!globalThis.__vvRateBuckets) globalThis.__vvRateBuckets = buckets

interface Config {
  capacity: number
  refillPerSec: number
}

// Bound the map: keys can be attacker-chosen on public routes (inbound webhooks
// key by client address). Past the cap, drop buckets idle long enough to be
// full again; if that frees nothing, drop the oldest. A lost bucket only means
// one extra allowance, never a lockout.
const MAX_BUCKETS = 10_000
const IDLE_MS = 5 * 60_000

function sweep(now: number): void {
  if (buckets.size < MAX_BUCKETS) return
  for (const [k, v] of buckets) if (now - v.updatedAt > IDLE_MS) buckets.delete(k)
  if (buckets.size < MAX_BUCKETS) return
  const drop = buckets.size - MAX_BUCKETS + 1
  let n = 0
  for (const k of buckets.keys()) {
    if (n++ >= drop) break
    buckets.delete(k)
  }
}

export function takeTokenInProcess(
  key: string,
  cfg: Config,
): { ok: boolean; retryAfterMs: number } {
  const now = Date.now()
  if (!buckets.has(key)) sweep(now)
  const b = buckets.get(key) ?? { tokens: cfg.capacity, updatedAt: now }
  const elapsedSec = (now - b.updatedAt) / 1000
  b.tokens = Math.min(cfg.capacity, b.tokens + elapsedSec * cfg.refillPerSec)
  b.updatedAt = now
  if (b.tokens >= 1) {
    b.tokens -= 1
    buckets.set(key, b)
    return { ok: true, retryAfterMs: 0 }
  }
  buckets.set(key, b)
  const needed = 1 - b.tokens
  return { ok: false, retryAfterMs: Math.ceil((needed / cfg.refillPerSec) * 1000) }
}
