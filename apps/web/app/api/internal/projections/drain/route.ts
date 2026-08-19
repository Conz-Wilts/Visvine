import { NextRequest, NextResponse } from 'next/server'
import { verifyTickCaller } from '@/lib/agents/internalAuth'
import { drainProjections, projectionBacklog } from '@/lib/notes/projections'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

/**
 * Retry the note projections nobody settled — the crash-recovery half of the
 * write-path outbox (lib/notes/projections.ts).
 *
 * A dedicated endpoint so the drain CAN be given its own Cloud Scheduler job and
 * its own alerting, but it deliberately does not need one: the agent tick
 * already runs every minute and drains as its last step, so this ships working
 * with zero operational change. Point a scheduler at it only if you want the
 * drain to survive the agents feature being switched off.
 *
 * Same OIDC verification as the tick — /api/internal/ is public in proxy.ts, so
 * the route authenticates itself. GET is accepted because Scheduler can be
 * configured either way.
 */
export async function POST(req: NextRequest) {
  const denied = await verifyTickCaller(req)
  if (denied) return NextResponse.json({ error: denied }, { status: 401 })
  const report = await drainProjections()
  return NextResponse.json({ ok: true, ...report, backlog: await projectionBacklog() })
}

export const GET = POST
