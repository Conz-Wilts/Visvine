import { NextRequest, NextResponse } from 'next/server'
import { verifyTickCaller } from '@/lib/agents/internalAuth'
import { tick } from '@/lib/agents/schedule'

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
  return NextResponse.json({
    ok: true,
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
