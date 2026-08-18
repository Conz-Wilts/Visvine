import { NextRequest, NextResponse } from 'next/server'
import { isSuperAdmin, requireSession } from '@/lib/session'
import { listRecentDecisions, listReviewQueue, perimeterDiffForVersion } from '@/lib/tools/registry'
import { EMPTY_PERIMETER, diffPerimeter } from '@/lib/tools/perimeter'
import type { ReviewHistoryResponse, ReviewQueueItem, ReviewQueueResponse } from '@/lib/tools/api'

/** How far back the reviewer's own trail reads. A queue, not an archive. */
const HISTORY_LIMIT = 25

/**
 * The Visvine super admin's review queue: every version awaiting a decision,
 * oldest submission first, each carrying the diff of its declared reach against
 * the last approved version of the same Tool — the question a reviewer is
 * actually being asked.
 *
 * One diff query per row rather than a join: the queue is pending submissions
 * only, so it is a handful of rows, and the diff needs the PREVIOUS approved
 * version of each key, which is a different lookup per row anyway.
 *
 * `?status=reviewed` answers with the decisions already made instead — the
 * History list beside the queue. Same route because it is the same screen and
 * the same gate; the envelope differs (`reviewed`, not `queue`) so a caller
 * cannot mistake a decided version for one still waiting.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession()
  if (session instanceof Response) return session
  if (!isSuperAdmin(session.email)) {
    return NextResponse.json(
      { error: 'Only Visvine super admins can review tool submissions.' },
      { status: 403 },
    )
  }

  if (req.nextUrl.searchParams.get('status') === 'reviewed') {
    const body: ReviewHistoryResponse = { reviewed: await listRecentDecisions(HISTORY_LIMIT) }
    return NextResponse.json(body)
  }

  const pending = await listReviewQueue()
  const diffs = await Promise.all(pending.map((version) => perimeterDiffForVersion(version.id)))
  const queue: ReviewQueueItem[] = pending.map((version, at) => ({
    ...version,
    perimeterDiff: diffs[at]?.diff ?? diffPerimeter(EMPTY_PERIMETER, version.perimeter),
    previousVersion: diffs[at]?.previous ?? null,
  }))

  const body: ReviewQueueResponse = { queue }
  return NextResponse.json(body)
}
