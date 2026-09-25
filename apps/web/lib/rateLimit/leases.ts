/**
 * A concurrency cap shared by every instance: "at most N of these at once".
 *
 * A token bucket (./index.ts) limits a RATE; this limits how many are in
 * flight. Each key has slots 0..cap-1, and holding one is a row in
 * `rate_limit_leases` until the holder releases it or its lease runs out — the
 * expiry is what frees a slot whose holder crashed mid-call, so nothing ever
 * has to sweep for a stranded count the way an in-process counter would need.
 *
 * TAKING IS ONE STATEMENT. The lowest free slot is claimed with an INSERT …
 * ON CONFLICT DO UPDATE that only overwrites an EXPIRED lease, so two callers
 * racing for the same slot serialize on its row: one wins, the other matches
 * nothing and is refused. A refusal under that race is a false "busy", never a
 * slot held twice — the right direction for a limiter to err in.
 *
 * FAILURE IS OPEN, BUT NOT UNBOUNDED: with Postgres unreachable the caller's
 * in-process fallback decides, the same trade the token bucket makes.
 */
import { createHash, randomUUID } from 'node:crypto'
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'

export interface Lease {
  /** Give the slot back. Idempotent; never throws. */
  release(): Promise<void>
}

function leaseKey(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 32)
}

/**
 * Take one of `cap` slots under `key` for at most `ttlMs`, or null when all
 * are held. Throws only when the store is unreachable — the caller picks the
 * fallback, because only it knows what a weaker limit should be.
 */
export async function acquireLease(key: string, cap: number, ttlMs: number): Promise<Lease | null> {
  const id = leaseKey(key)
  const holder = randomUUID()
  const slots = Math.max(1, Math.floor(cap))
  const ttlSec = Math.max(1, ttlMs) / 1000
  const rows = await prisma.$queryRaw<Array<{ slot: number }>>`
    WITH free AS (
      SELECT s AS slot
      FROM generate_series(0, ${slots - 1}::int) AS s
      WHERE NOT EXISTS (
        SELECT 1 FROM rate_limit_leases l
        WHERE l.key = ${id} AND l.slot = s AND l.expires_at > now()
      )
      ORDER BY s
      LIMIT 1
    )
    INSERT INTO rate_limit_leases (key, slot, holder, expires_at)
    SELECT ${id}, slot, ${holder}, now() + make_interval(secs => ${ttlSec}::double precision)
    FROM free
    ON CONFLICT (key, slot) DO UPDATE
      SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at
      WHERE rate_limit_leases.expires_at <= now()
    RETURNING slot
  `
  const slot = rows[0]?.slot
  if (slot === undefined) return null
  let released = false
  return {
    async release() {
      if (released) return
      released = true
      try {
        await prisma.$executeRaw`
          DELETE FROM rate_limit_leases WHERE key = ${id} AND slot = ${slot} AND holder = ${holder}
        `
      } catch (err) {
        // The lease expires by itself; a failed release only holds the slot
        // until then.
        logger.warn('rateLimit.lease.release_failed', { err })
      }
    },
  }
}

/** Drop leases that ran out. Called by the nightly maintenance run. */
export async function pruneLeases(): Promise<number> {
  return prisma.$executeRaw`DELETE FROM rate_limit_leases WHERE expires_at <= now()`
}
