import { NextRequest, NextResponse } from 'next/server'
import { isSuperAdmin, requireSession } from '@/lib/session'
import { isActiveMemberOf } from '@/lib/spaces/tree'
import { getVersion, perimeterDiffForVersion, versionHistory } from '@/lib/tools/registry'
import { EMPTY_PERIMETER, diffPerimeter } from '@/lib/tools/perimeter'
import type { VersionDetail, VersionHistoryEntry, VersionResponse } from '@/lib/tools/api'

/**
 * One registry version, opened — the marketplace detail drawer and the author's
 * publication trail.
 *
 * Two visibility rules, both narrower than the browse listing:
 *
 *  • Only a LISTED version is readable by a stranger. A version its own space
 *    approved but never offered to anyone is that space's business, and a
 *    signed-in session is not a membership — so this route asks for one, and a
 *    version nobody outside the space may install is not readable outside it
 *    either. Its author and a Visvine super admin always read it.
 *  • The two code sources ride along only for those last two. A listed Tool's
 *    declared reach is public — installing it is a decision a stranger may need
 *    to make — but its source is the author's.
 *
 * `indexSource` is the Tool's docs, not code, so it is always present: the
 * detail drawer renders it as the long description.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params
  const session = await requireSession()
  if (session instanceof Response) return session

  const version = await getVersion(versionId)
  if (!version) return NextResponse.json({ error: 'No such tool version.' }, { status: 404 })

  const privileged = isSuperAdmin(session.email) || version.author.userId === session.userId
  const listed = version.status === 'approved' && version.marketplaceStatus === 'approved'
  const readable =
    privileged || listed || (await isActiveMemberOf(session.userId, version.sourceSpaceId))
  if (!readable) {
    // 404 rather than 403: an unlisted snapshot should not be discoverable by
    // the shape of the refusal either.
    return NextResponse.json({ error: 'No such tool version.' }, { status: 404 })
  }

  const [diff, history] = await Promise.all([
    perimeterDiffForVersion(versionId),
    versionHistory(version.key),
  ])

  const { uiSource, dataSource, ...publicFields } = version
  const detail: VersionDetail = {
    ...publicFields,
    perimeterDiff: diff?.diff ?? diffPerimeter(EMPTY_PERIMETER, version.perimeter),
    previousVersion: diff?.previous ? { id: diff.previous.id, version: diff.previous.version } : null,
    history: history.map(
      (entry): VersionHistoryEntry => ({
        version: entry.version,
        status: entry.status,
        reviewedAt: entry.reviewedAt,
        releaseNotes: entry.releaseNotes,
      }),
    ),
    ...(privileged ? { uiSource, dataSource } : {}),
  }

  const body: VersionResponse = { version: detail }
  return NextResponse.json(body)
}
