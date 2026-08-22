/**
 * Token-bucket rate limiting, shared by every instance.
 *
 * The bucket is a row (`rate_limit_buckets`), not a Map entry, because the
 * deployment is not one process: a per-process limiter on a service that scales
 * out is N limiters, each with its own full allowance, and every cold start
 * mints another one. That is fine for a courtesy throttle and useless for the
 * two limiters that face an adversary — sign-in and inbound webhooks.
 *
 * SPENDING IS ONE STATEMENT. Refill-from-elapsed-time and spend-a-token happen
 * inside the same INSERT … ON CONFLICT DO UPDATE, so concurrent callers for the
 * same key serialize on that row's lock instead of read-modify-writing over
 * each other. The `WHERE` on the conflict branch is the allow/deny decision:
 * update the row and return it, or match nothing and return no rows.
 *
 * FAILURE IS OPEN, BUT NOT UNBOUNDED. If Postgres is unreachable the limiter
 * falls back to the in-process bucket rather than rejecting real traffic — a
 * rate limiter that takes the site down when the database blips has converted a
 * degradation into an outage. The fallback is a weaker limit, never no limit.
 */
import { createHash } from 'node:crypto'
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { takeTokenInProcess } from './memory'

export interface RateLimitConfig {
  /** Burst size: how many calls are allowed back-to-back from a full bucket. */
  capacity: number
  /** Sustained rate, tokens per second. */
  refillPerSec: number
}

export interface RateLimitResult {
  ok: boolean
  retryAfterMs: number
}

/** Default for authenticated message sends: 20 burst, 2/s sustained. */
const MESSAGE_SEND_LIMIT: RateLimitConfig = { capacity: 20, refillPerSec: 2 }

/**
 * Keys come from callers (an IP, an email, a space id). Hashing gives the
 * table a fixed-width primary key, keeps a raw email or address out of a table
 * that account deletion does not walk, and denies an attacker any control over
 * index layout. Truncated to 128 bits — collision here would merely mean two
 * unrelated callers sharing one budget, and 2^-128 is not a risk model.
 */
function bucketKey(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 32)
}

/**
 * How often a take also sweeps. Buckets that are full and idle carry no state
 * worth keeping — dropping one costs at most a single extra allowance — and the
 * key space on public routes is caller-chosen, so something has to bound it
 * between nightly runs. One sweep per ~500 takes is far cheaper than the write
 * it rides along with.
 */
const SWEEP_EVERY = 500
const SWEEP_IDLE_MS = 60 * 60 * 1000
let takesSinceSweep = 0

/**
 * Spend one token from `key`'s bucket.
 *
 * Returns `ok: false` with the wait until a token is available. Async by
 * necessity — the state is in Postgres.
 */
export async function takeToken(
  key: string,
  cfg: RateLimitConfig = MESSAGE_SEND_LIMIT,
): Promise<RateLimitResult> {
  const id = bucketKey(key)
  try {
    // `refilled` is the bucket's balance as of now. Computing it twice (once to
    // store, once to gate) rather than in a CTE keeps this a single statement
    // with a single row lock, which is the property that makes it atomic.
    const rows = await prisma.$queryRaw<Array<{ tokens: number }>>`
      INSERT INTO rate_limit_buckets (key, tokens, updated_at)
      VALUES (${id}, ${cfg.capacity - 1}::double precision, now())
      ON CONFLICT (key) DO UPDATE
        SET tokens = LEAST(
              ${cfg.capacity}::double precision,
              rate_limit_buckets.tokens
                + EXTRACT(EPOCH FROM (now() - rate_limit_buckets.updated_at))
                  * ${cfg.refillPerSec}::double precision
            ) - 1,
            updated_at = now()
        WHERE LEAST(
              ${cfg.capacity}::double precision,
              rate_limit_buckets.tokens
                + EXTRACT(EPOCH FROM (now() - rate_limit_buckets.updated_at))
                  * ${cfg.refillPerSec}::double precision
            ) >= 1
      RETURNING tokens
    `

    if (++takesSinceSweep >= SWEEP_EVERY) {
      takesSinceSweep = 0
      // Fire-and-forget: a failed sweep must never fail the request it rode in
      // on. The nightly run is the backstop.
      void pruneRateLimits(SWEEP_IDLE_MS).catch(() => {})
    }

    if (rows.length > 0) return { ok: true, retryAfterMs: 0 }

    // No row updated: the bucket was empty. Read the balance to say how long
    // the caller should wait. Only the denial path pays for this.
    const [current] = await prisma.$queryRaw<Array<{ balance: number }>>`
      SELECT LEAST(
        ${cfg.capacity}::double precision,
        tokens + EXTRACT(EPOCH FROM (now() - updated_at)) * ${cfg.refillPerSec}::double precision
      ) AS balance
      FROM rate_limit_buckets WHERE key = ${id}
    `
    const needed = 1 - (current?.balance ?? 0)
    return { ok: false, retryAfterMs: Math.max(0, Math.ceil((needed / cfg.refillPerSec) * 1000)) }
  } catch (err) {
    logger.error('rateLimit.store_unavailable', { err })
    return takeTokenInProcess(id, cfg)
  }
}

/**
 * Drop buckets that are idle and would have refilled to full anyway. Called
 * opportunistically above and unconditionally by the nightly maintenance run.
 * Returns how many rows went.
 */
export async function pruneRateLimits(idleMs = SWEEP_IDLE_MS): Promise<number> {
  const cutoff = new Date(Date.now() - idleMs)
  const { count } = await prisma.rateLimitBucket.deleteMany({
    where: { updatedAt: { lt: cutoff } },
  })
  return count
}
