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

export const MESSAGE_SEND_LIMIT: RateLimitConfig = { capacity: 20, refillPerSec: 2 };

export function takeToken(key: string, cfg: RateLimitConfig = MESSAGE_SEND_LIMIT): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
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
