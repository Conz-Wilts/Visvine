import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/api/route'
import { isSuperAdmin, requireSession, type SessionPayload } from '@/lib/session'
import {
  deleteVersion,
  getVersion,
  perimeterDiffForVersion,
  previousApprovedVersion,
  reviewVersion,
  versionHistory,
} from '@/lib/tools/registry'
import { EMPTY_PERIMETER, diffPerimeter } from '@/lib/tools/perimeter'
import type {
  ReviewDecisionResponse,
  ReviewDetailResponse,
  VersionDetail,
  VersionHistoryEntry,
  VersionSources,
} from '@/lib/tools/api'

/** Session + the super-admin gate the whole review surface sits behind. */
async function requireReviewer(): Promise<SessionPayload | Response> {
  const session = await requireSession()
  if (session instanceof Response) return session
  if (!isSuperAdmin(session.email)) {
    return NextResponse.json(
      { error: 'Only Visvine super admins can review tool submissions.' },
      { status: 403 },
    )
  }
  return session
}

/**
 * One submission, in full — the reviewer's screen.
 *
 * `previous` is the last APPROVED version of the same Tool and is the "before"
 * side of the code diff; it is null for a first submission, and null when every
 * earlier version was rejected, because a diff against something nobody shipped
 * answers the wrong question. Sources are always present here: reviewing is
 * reading the code.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params
  const session = await requireReviewer()
  if (session instanceof Response) return session

  const version = await getVersion(versionId)
  if (!version) return NextResponse.json({ error: 'No such tool version.' }, { status: 404 })

  const [diff, history, previous] = await Promise.all([
    perimeterDiffForVersion(versionId),
    versionHistory(version.key),
    previousApprovedVersion(version.key, version.version),
  ])

  const detail: VersionDetail = {
    ...version,
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
  }
  const before: VersionSources | null = previous
    ? {
        id: previous.id,
        version: previous.version,
        indexSource: previous.indexSource,
        uiSource: previous.uiSource,
        dataSource: previous.dataSource,
      }
    : null

  const body: ReviewDetailResponse = { version: detail, previous: before }
  return NextResponse.json(body)
}

const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().max(4000).optional(),
})

/**
 * The verdict. Approving does one thing beyond flipping the status: every
 * install pinned to an older version of this Tool is offered this one as an
 * upgrade (`upgraded` counts them). An admin in each of those spaces still has
 * to apply it after reading the perimeter diff — approval never changes code
 * under anyone.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params
  const session = await requireReviewer()
  if (session instanceof Response) return session

  const body = await parseBody(req, decisionSchema)
  if (body instanceof NextResponse) return body

  const result = await reviewVersion(
    versionId,
    body.decision,
    { userId: session.userId, email: session.email },
    body.note,
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  const answer: ReviewDecisionResponse = { version: result.version, upgraded: result.upgraded }
  return NextResponse.json(answer)
}

/**
 * Remove a version from the registry for good — the reviewer's bin. Refused
 * while any space runs it (409, naming the count): uninstalling those is each
 * space's own decision, not the reviewer's.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params
  const session = await requireReviewer()
  if (session instanceof Response) return session

  const result = await deleteVersion(versionId, { userId: session.userId, email: session.email })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true })
}
