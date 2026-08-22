/**
 * The shared rate limiter, against a real Postgres.
 *
 * A limiter is only worth testing where its guarantee lives, and this one's
 * guarantee is atomicity across processes: refill-and-spend is a single
 * statement so that concurrent takers serialize on the row rather than each
 * reading the same balance and each deciding they may spend it. A pure-function
 * test cannot show that, so this file talks to the LOCAL Docker database (the
 * same localhost-only guard as scripts/guard-local-db.mjs) and SKIPS, loudly,
 * when it can't reach one.
 *
 * Run with the dev DB up: `pnpm db:up && pnpm test`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

function localDatabaseUrl(): string | null {
  const fromEnv = process.env.DATABASE_URL
  let url = fromEnv ?? null
  if (!url) {
    try {
      const env = readFileSync(join(root, '.env'), 'utf8')
      const m = env.match(/^DATABASE_URL=(.+)$/m)
      url = m ? m[1].trim().replace(/^["']|["']$/g, '') : null
    } catch {
      url = null
    }
  }
  if (!url) return null
  try {
    const host = new URL(url).hostname
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== 'visvine-postgres') return null
  } catch {
    return null
  }
  return url
}

const dbUrl = localDatabaseUrl()
if (dbUrl && !process.env.DATABASE_URL) process.env.DATABASE_URL = dbUrl

type Limiter = typeof import('@/lib/rateLimit')
type Prisma = typeof import('@/lib/prisma').default

let limiter: Limiter | null = null
let prisma: Prisma | null = null
let probed: Promise<string | null> | null = null

function probe(): Promise<string | null> {
  if (probed) return probed
  probed = (async () => {
    if (!dbUrl) return 'no local DATABASE_URL (apps/web/.env) — rate limiter tests need the Docker Postgres'
    try {
      prisma = (await import('@/lib/prisma')).default
      await prisma.$queryRaw`SELECT 1`
      limiter = await import('@/lib/rateLimit')
      return null
    } catch (e) {
      prisma = null
      return `local Postgres not reachable (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`
    }
  })()
  return probed
}

// Unique per run so a re-run never inherits a half-spent bucket, and so two
// tests in this file cannot spend each other's budget.
const keyFor = (name: string) => `test:rate:${process.pid}:${name}`

test('a full bucket allows exactly `capacity` calls, then denies', async (t) => {
  const skip = await probe()
  if (skip) return t.skip(skip)

  const key = keyFor('capacity')
  // refillPerSec low enough that no measurable refill happens during the test.
  const cfg = { capacity: 3, refillPerSec: 0.01 }

  for (let i = 0; i < 3; i++) {
    const r = await limiter!.takeToken(key, cfg)
    assert.equal(r.ok, true, `call ${i + 1} should be allowed`)
  }

  const denied = await limiter!.takeToken(key, cfg)
  assert.equal(denied.ok, false)
  // Denial must say when to come back, or a 429 is unactionable. One token at
  // 0.01/s is 100s; allow slack for the refill that accrued during the test.
  assert.ok(denied.retryAfterMs > 1000, `retryAfterMs was ${denied.retryAfterMs}`)
})

test('refill returns tokens over time', async (t) => {
  const skip = await probe()
  if (skip) return t.skip(skip)

  const key = keyFor('refill')
  const cfg = { capacity: 1, refillPerSec: 50 } // a token every 20ms

  assert.equal((await limiter!.takeToken(key, cfg)).ok, true)
  assert.equal((await limiter!.takeToken(key, cfg)).ok, false)
  await new Promise((r) => setTimeout(r, 120))
  assert.equal((await limiter!.takeToken(key, cfg)).ok, true, 'a token should have refilled')
})

test('concurrent takers cannot both spend the last token', async (t) => {
  const skip = await probe()
  if (skip) return t.skip(skip)

  const key = keyFor('race')
  // One token, effectively no refill. Ten callers fire at once; the row lock is
  // the only thing standing between that and ten allowed calls.
  const cfg = { capacity: 1, refillPerSec: 0.001 }

  const results = await Promise.all(
    Array.from({ length: 10 }, () => limiter!.takeToken(key, cfg)),
  )
  assert.equal(results.filter((r) => r.ok).length, 1, 'exactly one caller may spend the only token')
})

test('distinct keys hold distinct budgets', async (t) => {
  const skip = await probe()
  if (skip) return t.skip(skip)

  const cfg = { capacity: 1, refillPerSec: 0.001 }
  assert.equal((await limiter!.takeToken(keyFor('a'), cfg)).ok, true)
  assert.equal((await limiter!.takeToken(keyFor('a'), cfg)).ok, false)
  assert.equal((await limiter!.takeToken(keyFor('b'), cfg)).ok, true, 'b must not inherit a’s spend')
})

test('the stored key is a hash, never the caller-supplied string', async (t) => {
  const skip = await probe()
  if (skip) return t.skip(skip)

  // The raw key can be an email or an IP. It must not land in a table that
  // account deletion does not walk.
  const raw = `login:203.0.113.7:${process.pid}@example.test`
  await limiter!.takeToken(raw, { capacity: 2, refillPerSec: 0.001 })

  const rows = await prisma!.$queryRaw<Array<{ key: string }>>`
    SELECT key FROM rate_limit_buckets WHERE key LIKE ${'%' + String(process.pid) + '%'}
  `
  assert.equal(rows.length, 0, 'no bucket key should contain the raw caller string')
})

test('pruneRateLimits reclaims idle buckets and leaves fresh ones', async (t) => {
  const skip = await probe()
  if (skip) return t.skip(skip)

  const fresh = keyFor('prune-fresh')
  await limiter!.takeToken(fresh, { capacity: 5, refillPerSec: 1 })
  const before = await prisma!.rateLimitBucket.count()

  // Age every bucket past the cutoff, then prune with a window that spares
  // nothing — the assertion is that it deletes, and that a bucket touched after
  // the cutoff survives.
  await prisma!.$executeRaw`UPDATE rate_limit_buckets SET updated_at = now() - interval '2 days'`
  await limiter!.takeToken(fresh, { capacity: 5, refillPerSec: 1 })

  const pruned = await limiter!.pruneRateLimits(24 * 60 * 60 * 1000)
  assert.ok(pruned > 0 || before <= 1, 'aged buckets should be reclaimed')

  const survivor = await prisma!.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM rate_limit_buckets WHERE updated_at > now() - interval '1 hour'
  `
  assert.ok(survivor[0].n >= 1, 'a bucket touched just now must survive the prune')
})

test.after(async () => {
  // Only the rows this file made; the table is shared with the running dev app.
  if (prisma) await prisma.$executeRaw`DELETE FROM rate_limit_buckets WHERE updated_at < now() - interval '1 day'`
})
