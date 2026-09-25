/**
 * The bridge's limits as ROWS (lib/tools/limits.ts): the call budget and the
 * `data.call` cap are shared by every instance, so they are proved against the
 * local Postgres. Skips, loudly, without one — the same guard as
 * tests/rate-limit.test.ts.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

function localDatabaseUrl(): string | null {
  let url = process.env.DATABASE_URL ?? null
  if (!url) {
    try {
      const m = readFileSync(join(root, '.env'), 'utf8').match(/^DATABASE_URL=(.+)$/m)
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

let probed: Promise<string | null> | null = null
function probe(): Promise<string | null> {
  if (probed) return probed
  probed = (async () => {
    if (!dbUrl) return 'no local DATABASE_URL (apps/web/.env) — row limits need the Docker Postgres'
    try {
      const prisma = (await import('@/lib/prisma')).default
      await prisma.$queryRaw`SELECT 1 FROM rate_limit_leases LIMIT 1`
      return null
    } catch (err) {
      return `local Postgres unreachable or unmigrated: ${(err as Error).message.split('\n')[0]}`
    }
  })()
  return probed
}

const key = (name: string) => `test:tools-limits:${process.pid}:${name}`

test('two data handlers at once per target, shared by every caller; a released slot frees', async (t) => {
  const skip = await probe()
  if (skip) return t.skip(skip)
  const { acquireDataCallShared } = await import('@/lib/tools/limits')

  const first = await acquireDataCallShared(key('data'))
  const second = await acquireDataCallShared(key('data'))
  assert.ok(first && second, 'the cap is two')
  assert.equal(await acquireDataCallShared(key('data')), null, 'a third waits for a slot')
  first!()
  await new Promise((resolve) => setTimeout(resolve, 50))
  const again = await acquireDataCallShared(key('data'))
  assert.ok(again, 'a released slot is taken again')
  second!()
  again!()
})

test('the call budget is one bucket per viewer per target, however many instances ask', async (t) => {
  const skip = await probe()
  if (skip) return t.skip(skip)
  const { takeBridgeCallShared } = await import('@/lib/tools/limits')

  const results = await Promise.all(Array.from({ length: 6 }, () => takeBridgeCallShared(key('rate'), 4)))
  assert.equal(results.filter((r) => r.ok).length, 4, 'exactly the limit is spent, never more')
  const refused = results.find((r) => !r.ok)
  assert.ok(refused && !refused.ok && refused.retryAfterMs > 0)
  assert.equal((await takeBridgeCallShared(key('other-target'), 4)).ok, true, 'another target has its own budget')
})

test.after(async () => {
  if (!dbUrl) return
  const prisma = (await import('@/lib/prisma')).default
  await prisma.$executeRaw`DELETE FROM rate_limit_leases WHERE expires_at <= now() + interval '1 minute'`
})
