/**
 * Simple in-memory sliding-window rate limiter for the CSV import endpoint.
 * Keyed by a composite of userId + communityId.
 *
 * Limits: 5 imports per hour per user/community pair.
 */

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS = 5;

const store = new Map<string, number[]>();

export function checkImportRateLimit(
  userId: string,
  communityId: string
): { allowed: boolean; retryAfterMs: number } {
  const key = `${userId}:${communityId}`;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  const timestamps = (store.get(key) ?? []).filter((t) => t > windowStart);

  if (timestamps.length >= MAX_REQUESTS) {
    const oldest = timestamps[0];
    return { allowed: false, retryAfterMs: oldest + WINDOW_MS - now };
  }

  timestamps.push(now);
  store.set(key, timestamps);
  return { allowed: true, retryAfterMs: 0 };
}
