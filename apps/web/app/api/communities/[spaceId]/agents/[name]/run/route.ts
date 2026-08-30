import { NextRequest, NextResponse } from 'next/server'
import { bad, requireAgentsAccess } from '@/lib/agents/route'
import { canTriggerRun } from '@/lib/agents/service'
import { claimManualRun } from '@/lib/agents/schedule'
import { dispatchMode } from '@/lib/agents/dispatch'

// In `inline` dispatch (dev) the run happens inside this request.
// Segment config must be a literal Next can read statically: MAX_RUN_MS (25 min) + 60s.
export const maxDuration = 1560

/**
 * "Run now" — anyone who can edit the brief (author, admin, or a member whose
 * grant reaches the agent's folder), ACTIVE agents only: an agent that is off
 * has no schedule or run-as to run under.
 * Shares the scheduler's claim path (same compare-and-swap) so it cannot
 * collide with a scheduled firing, and does not advance the schedule.
 *
 * The request HOLDS until the run finishes (in production it awaits the
 * self-dispatch to the run endpoint; in dev the run happens inline). Never
 * fire-and-forget: Cloud Run may throttle CPU once a response is sent, which
 * is exactly how a kicked-off dispatch would silently never happen. The UI
 * starts polling the runs list as soon as it has sent the request.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ spaceId: string; name: string }> }) {
  const { spaceId, name: raw } = await params
  const name = decodeURIComponent(raw)
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const { principal } = ctx
  if (!(await canTriggerRun(principal, spaceId, name))) return bad('Only someone who can edit this agent can run it.', 403)

  const claimed = await claimManualRun(spaceId, name, principal.userId)
  if (!claimed.ok) return bad(claimed.message, claimed.code === 'unknown' ? 404 : 409)

  const result = await claimed.dispatch
  return NextResponse.json({
    ok: true,
    runId: claimed.runId,
    mode: dispatchMode(),
    outcome: result?.ok ? result.outcome : null,
    error: result && !result.ok ? result.error : null,
  })
}
