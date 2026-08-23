import { NextRequest, NextResponse } from 'next/server'
import { isSuperAdmin, requireSession } from '@/lib/session'
import { listReviewQueue, perimeterDiffForVersion } from '@/lib/tools/registry'
import { EMPTY_PERIMETER, diffPerimeter } from '@/lib/tools/perimeter'
import type { ReviewQueueItem, ReviewQueueResponse } from '@/lib/tools/api'

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
 * A queue, not an archive: decided versions leave it and are not re-listed —
 * each Tool's own detail (versionHistory on the authoring route, the version
 * trail on the marketplace card) is where a past verdict is read.
 */
export async function GET(_req: NextRequest) {
  const session = await requireSession()
  if (session instanceof Response) return session
  if (!isSuperAdmin(session.email)) {
    return NextResponse.json(
      { error: 'Only Visvine super admins can review tool submissions.' },
      { status: 403 },
    )
  }

  const pending = await listReviewQueue()
  const diffs = await Promise.all(pending.map((version) => perimeterDiffForVersion(version.id)))
  const queue: ReviewQueueItem[] = pending.map((version, at) => {
    const previous = diffs[at]?.previous
    return {
      ...version,
      perimeterDiff: diffs[at]?.diff ?? diffPerimeter(EMPTY_PERIMETER, version.perimeter),
      previousVersion: previous ? { id: previous.id, version: previous.version } : null,
    }
  })

  const body: ReviewQueueResponse = { queue }
  return NextResponse.json(body)
}
