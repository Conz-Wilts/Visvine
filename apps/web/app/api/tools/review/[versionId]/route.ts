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
import { versionReports } from '@/lib/tools/checks/runs'
import { revokeVersion, setListingState } from '@/lib/tools/verdicts'
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

  const [diff, history, previous, reports] = await Promise.all([
    perimeterDiffForVersion(versionId),
    versionHistory(version.key),
    previousApprovedVersion(version.key, version.version),
    versionReports([versionId]),
  ])

  const detail: VersionDetail = {
    ...version,
    perimeterDiff: diff?.diff ?? diffPerimeter(EMPTY_PERIMETER, version.perimeter),
    previousVersion: diff?.previous ? { id: diff.previous.id, version: diff.previous.version } : null,
    checks: reports.get(versionId)?.report ?? null,
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

const decisionSchema = z.union([
  z.object({
    decision: z.enum(['approved', 'rejected']),
    note: z.string().max(4000).optional(),
  }),
  // Visvine's holds after the fact (lib/tools/verdicts.ts): a listing
  // suspended, reinstated or removed for good, or one version withdrawn.
  z.object({ hold: z.enum(['suspended', 'active', 'revoked']), reason: z.string().max(500).optional() }),
  z.object({ revoke: z.literal(true), reason: z.string().max(500).optional() }),
])

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

  const reviewer = { userId: session.userId, email: session.email }
  if ('revoke' in body) {
    const pulled = await revokeVersion(versionId, reviewer, body.reason ?? null)
    if (!pulled.ok) return NextResponse.json({ error: pulled.error }, { status: pulled.status })
    return NextResponse.json({ ok: true })
  }
  if ('hold' in body) {
    const version = await getVersion(versionId)
    if (!version) return NextResponse.json({ error: 'No such tool version.' }, { status: 404 })
    const held = await setListingState(version.key, body.hold, reviewer, body.reason ?? null)
    if (!held.ok) return NextResponse.json({ error: held.error }, { status: held.status })
    return NextResponse.json({ ok: true })
  }

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
