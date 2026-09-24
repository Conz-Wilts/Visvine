/**
 * The local Docker Postgres for tests that race rows — the guard
 * tests/agents-tick.test.ts established: `apps/web/.env` DATABASE_URL, host
 * localhost/127.0.0.1/visvine-postgres only (the same rule as
 * scripts/guard-local-db.mjs), and a skip REASON rather than a pass when it is
 * not there, so CI (no Postgres) reports these as skipped.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))

function localDatabaseUrl(): string | null {
  let url = process.env.DATABASE_URL ?? null
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

type Prisma = typeof import('@/lib/prisma').default

let probed: Promise<{ prisma: Prisma | null; skip: string | null }> | null = null

/** Connect once; `skip` is why these tests cannot run here, or null. */
export function localDb(): Promise<{ prisma: Prisma | null; skip: string | null }> {
  if (probed) return probed
  probed = (async () => {
    const url = localDatabaseUrl()
    if (!url) return { prisma: null, skip: 'no local DATABASE_URL (apps/web/.env) — needs the Docker Postgres' }
    if (!process.env.DATABASE_URL) process.env.DATABASE_URL = url
    if (!process.env.SECRETS_KEY) process.env.SECRETS_KEY = 'ff'.repeat(32)
    if (!process.env.AUTH_SECRET) process.env.AUTH_SECRET = 'test-secret-'.repeat(4)
    try {
      const prisma = (await import('@/lib/prisma')).default
      await prisma.$queryRaw`SELECT 1`
      return { prisma, skip: null }
    } catch (e) {
      return { prisma: null, skip: `local Postgres not reachable (${e instanceof Error ? e.message.split('\n')[0] : String(e)})` }
    }
  })()
  return probed
}
