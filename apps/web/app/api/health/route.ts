import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'

/**
 * Health probe. Public, unauthenticated, and deliberately thin on detail.
 *
 * Two modes, because they answer different questions:
 *
 *   GET /api/health          LIVENESS. Is this process running and able to
 *                            serve? Touches nothing external, so a database
 *                            outage does not get every instance killed and
 *                            restarted into the same outage.
 *
 *   GET /api/health?deep=1   READINESS. Are this revision's dependencies
 *                            actually reachable? Round-trips Postgres. This is
 *                            what the deploy smoke test calls before traffic is
 *                            moved onto a new revision, and the reason a broken
 *                            release now fails the pipeline instead of the user.
 *
 * The body names which check failed but never why — the reason is logged, not
 * served, because this endpoint answers to the open internet.
 */
export const dynamic = 'force-dynamic'

const DEEP_TIMEOUT_MS = 4000

async function checkDatabase(): Promise<boolean> {
  try {
    // A trivial round trip: proves the pool can hand out a live connection,
    // which is the failure this catches (Cloud SQL down, socket dropped,
    // credentials rotated out from under the revision).
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('database probe timed out')), DEEP_TIMEOUT_MS),
      ),
    ])
    return true
  } catch (err) {
    logger.error('health.database_unreachable', { err })
    return false
  }
}

export async function GET(req: NextRequest) {
  const deep = req.nextUrl.searchParams.get('deep') !== null

  const body: Record<string, unknown> = {
    ok: true,
    // Which revision answered. The smoke test asserts on this so it cannot pass
    // by reaching the OLD revision through a stale URL or a warm cache.
    revision: process.env.K_REVISION ?? null,
    uptimeSeconds: Math.round(process.uptime()),
  }

  if (!deep) {
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
  }

  const database = await checkDatabase()
  body.checks = { database }
  body.ok = database

  return NextResponse.json(body, {
    status: database ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  })
}
