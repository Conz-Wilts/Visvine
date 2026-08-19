import { NextRequest, NextResponse } from 'next/server'
import { verifyTickCaller } from '@/lib/agents/internalAuth'
import { tick } from '@/lib/agents/schedule'
import { drainProjections } from '@/lib/notes/projections'

// The tick awaits the dispatches it fans out (each its own request to the run
// endpoint), so it can last as long as the longest claimed run.
// Segment config must be a literal Next can read statically: MAX_RUN_MS (20 min) + 120s.
export const maxDuration = 1320
export const dynamic = 'force-dynamic'

/**
 * The scheduler tick. One Cloud Scheduler job every 5 minutes, OIDC-verified
 * here (Cloud Run is --allow-unauthenticated so IAM can't do it). Carries no
 * user session — /api/internal/ is listed in proxy.ts PUBLIC_PATHS and this
 * route authenticates itself. See lib/agents/schedule.ts.
 */
export async function POST(req: NextRequest) {
  const denied = await verifyTickCaller(req)
  if (denied) return NextResponse.json({ error: denied }, { status: 401 })
  const report = await tick(new Date())
  // The note write-path outbox rides this tick. It is unrelated to agents, but
  // it needs a heartbeat and this is the only one the deployment already has —
  // giving the drain its own Cloud Scheduler job would be cleaner and is
  // available at /api/internal/projections/drain, so nothing here is load-bearing.
  // Never allowed to fail the tick: a stuck projection must not stop agent runs.
  const projections = await drainProjections().catch((err) => {
    console.error('[tick] projection drain failed:', err)
    return null
  })
  return NextResponse.json({
    ok: true,
    projections,
    reclaimed: report.reclaimed,
    pruned: report.pruned,
    considered: report.considered,
    claimed: report.claimed,
    dispatched: report.dispatched.map((d) => ({
      runId: d.runId,
      ok: d.result.ok,
      outcome: d.result.ok ? d.result.outcome : null,
      error: d.result.ok ? null : d.result.error,
    })),
  })
}

// Scheduler can be configured with GET as well; accept both.
export const GET = POST
