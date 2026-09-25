import { NextRequest, NextResponse } from 'next/server'
import { isSuperAdmin, requireSession } from '@/lib/session'
import { listReviewQueue, perimeterDiffForVersion } from '@/lib/tools/registry'
import { EMPTY_PERIMETER, diffPerimeter } from '@/lib/tools/perimeter'
import { versionReports } from '@/lib/tools/checks/runs'
import prisma from '@/lib/prisma'
import { verifiedPublishers } from '@/lib/tools/publishers'
import type { ReviewQueueItem, ReviewQueueResponse } from '@/lib/tools/api'

/**
 * The Visvine super admin's review queue: every version awaiting a decision,
 * oldest submission first, each carrying the diff of its declared reach against
 * the last approved version of the same Tool — the question a reviewer is
 * actually being asked — and the checks the author already saw.
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
  const ids = pending.map((version) => version.id)
  const [diffs, reports, runs, listings] = await Promise.all([
    Promise.all(pending.map((version) => perimeterDiffForVersion(version.id))),
    versionReports(ids),
    prisma.appToolReviewRun.findMany({
      where: { versionId: { in: ids } },
      orderBy: { createdAt: 'desc' },
      select: { versionId: true, status: true, runner: true, startedAt: true, finishedAt: true, error: true },
    }),
    prisma.appToolVersion.findMany({
      where: { id: { in: ids } },
      select: { id: true, cosignedBy: true, listingId: true },
    }),
  ])
  const verified = await verifiedPublishers(pending.map((version) => version.sourceSpaceId))
  const queue: ReviewQueueItem[] = pending.map((version, at) => {
    const previous = diffs[at]?.previous
    const run = runs.find((row) => row.versionId === version.id)
    const listed = listings.find((row) => row.id === version.id)
    return {
      ...version,
      perimeterDiff: diffs[at]?.diff ?? diffPerimeter(EMPTY_PERIMETER, version.perimeter),
      previousVersion: previous ? { id: previous.id, version: previous.version } : null,
      checks: reports.get(version.id)?.report ?? null,
      review: run
        ? {
            status: run.status,
            runner: run.runner,
            startedAt: run.startedAt?.toISOString() ?? null,
            finishedAt: run.finishedAt?.toISOString() ?? null,
            error: run.error,
          }
        : null,
      listing: listed?.listingId
        ? { id: listed.listingId, verified: verified.has(version.sourceSpaceId), cosignedBy: listed.cosignedBy }
        : null,
    }
  })

  const body: ReviewQueueResponse = { queue }
  return NextResponse.json(body)
}
