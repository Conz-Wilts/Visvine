// Simple in-memory token bucket per user. Swap to Redis in production.

type Bucket = { tokens: number; updatedAt: number };

declare global {
  var __nbRateBuckets: Map<string, Bucket> | undefined;
}

const buckets: Map<string, Bucket> = globalThis.__nbRateBuckets ?? new Map();
if (!globalThis.__nbRateBuckets) globalThis.__nbRateBuckets = buckets;

export interface RateLimitConfig {
  capacity: number;
  refillPerSec: number;
}

const MESSAGE_SEND_LIMIT: RateLimitConfig = { capacity: 20, refillPerSec: 2 };

// Bound the map: keys can be attacker-chosen on public routes (inbound
// webhooks key by client address). Past the cap, drop buckets idle long enough
// to be full again; if that frees nothing, drop the oldest. A lost bucket only
// means one extra allowance, never a lockout.
const MAX_BUCKETS = 10_000;
const IDLE_MS = 5 * 60_000;

function sweep(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [k, v] of buckets) if (now - v.updatedAt > IDLE_MS) buckets.delete(k);
  if (buckets.size < MAX_BUCKETS) return;
  const drop = buckets.size - MAX_BUCKETS + 1;
  let n = 0;
  for (const k of buckets.keys()) {
    if (n++ >= drop) break;
    buckets.delete(k);
  }
}

export function takeToken(key: string, cfg: RateLimitConfig = MESSAGE_SEND_LIMIT): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  if (!buckets.has(key)) sweep(now);
  const b = buckets.get(key) ?? { tokens: cfg.capacity, updatedAt: now };
  const elapsedSec = (now - b.updatedAt) / 1000;
  b.tokens = Math.min(cfg.capacity, b.tokens + elapsedSec * cfg.refillPerSec);
  b.updatedAt = now;
  if (b.tokens >= 1) {
    b.tokens -= 1;
    buckets.set(key, b);
    return { ok: true, retryAfterMs: 0 };
  }
  buckets.set(key, b);
  const needed = 1 - b.tokens;
  return { ok: false, retryAfterMs: Math.ceil((needed / cfg.refillPerSec) * 1000) };
}
