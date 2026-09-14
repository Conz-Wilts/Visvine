import { NextRequest, NextResponse } from 'next/server'
import { bad, requireAgentsAccess } from '@/lib/agents/route'
import { canTriggerRun } from '@/lib/agents/service'
import { claimManualRun } from '@/lib/agents/schedule'
import { dispatchMode, dispatchWithin } from '@/lib/agents/dispatch'

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
 * The request holds for the dispatch, but only for RUN_AWAIT_MS: long enough
 * that a short run answers with its outcome in one round trip, and short
 * enough that a long one does not pin the instance serving this request for
 * its whole 25 minutes. It is still never fire-and-forget — the wait is what
 * gets the run CARRIED, because Cloud Run may throttle CPU once a response is
 * sent, and by the time it is given up the run is already in flight on the
 * run endpoint's own request. A run still going answers `running: true`; the
 * UI has been polling the runs list since it sent this.
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

  const result = claimed.dispatch ? await dispatchWithin(claimed.dispatch) : null
  return NextResponse.json({
    ok: true,
    runId: claimed.runId,
    mode: dispatchMode(),
    running: result === null,
    outcome: result?.ok ? result.outcome : null,
    error: result && !result.ok ? result.error : null,
  })
}
