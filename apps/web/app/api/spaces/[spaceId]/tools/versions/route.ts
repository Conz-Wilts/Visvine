import { NextRequest, NextResponse } from 'next/server'
import { EMPTY_PERIMETER, diffPerimeter } from '@/lib/tools/perimeter'
import { listSpaceApprovalQueue, perimeterDiffForVersion } from '@/lib/tools/registry'
import { bad, requireToolsAccess } from '@/lib/tools/route'
import type { ApprovalQueueItem, ApprovalQueueResponse } from '@/lib/tools/api'

/**
 * This space's own approval queue: every version a member published here that
 * an admin has not decided on yet, oldest first, each carrying the diff of its
 * declared reach against the last version this space approved.
 *
 * The space half of the Tool review — the marketplace queue next door
 * (`/api/tools/review`) asks a different question, of a different reviewer,
 * about a listing rather than about code. Admin-only, because the queue is the
 * decision: a member reading a list of things they cannot act on is a list.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  if (!ctx.resolved.isAdmin) return bad('Only space admins can review tools.', 403)

  const pending = await listSpaceApprovalQueue(ctx.resolved.spaceId)
  const diffs = await Promise.all(pending.map((version) => perimeterDiffForVersion(version.id, 'space')))
  const queue: ApprovalQueueItem[] = pending.map((version, at) => {
    const previous = diffs[at]?.previous
    return {
      ...version,
      perimeterDiff: diffs[at]?.diff ?? diffPerimeter(EMPTY_PERIMETER, version.perimeter),
      previousVersion: previous ? { id: previous.id, version: previous.version } : null,
    }
  })

  const body: ApprovalQueueResponse = { queue }
  return NextResponse.json(body)
}
