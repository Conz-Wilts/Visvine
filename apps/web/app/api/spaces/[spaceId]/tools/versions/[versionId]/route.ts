import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/api/route'
import { reviewSpaceVersion } from '@/lib/tools/registry'
import { cosignListing, requestListing, withdrawListing } from '@/lib/tools/listings'
import { bad, requireToolsAccess } from '@/lib/tools/route'
import { revokeVersion } from '@/lib/tools/verdicts'
import type { ApprovalDecisionResponse, ListingResponse } from '@/lib/tools/api'

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('review'),
    decision: z.enum(['approved', 'rejected']),
    note: z.string().max(4000).optional(),
  }),
  z.object({ action: z.literal('list'), note: z.string().max(4000).optional(), license: z.string().max(128).optional() }),
  z.object({ action: z.literal('cosign'), license: z.string().max(128) }),
  z.object({ action: z.literal('unlist') }),
  z.object({ action: z.literal('revoke'), reason: z.string().max(500).optional() }),
])

/**
 * The decisions made about a version of this space's own Tool.
 *
 * `review` is the update queue's verdict — approving is what makes the code
 * installable here and offers it to this space's existing installs. `revoke`
 * pulls an approved version back: it stops everywhere it runs at its next
 * bridge call (lib/tools/verdicts.ts). The rest go global
 * (lib/tools/listings.ts): `list` is a space admin asking Visvine to list the
 * version — co-signed at once when they wrote it — `cosign` is its author's
 * consent under a license, and `unlist` takes a request back (or, for the
 * author, a version still waiting on this space's admins).
 *
 * Every gate is the library's — the route hands it the actor and returns the
 * refusal verbatim, because "another space wrote this" and "approve it here
 * first" are the sentences an admin can act on.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string; versionId: string }> },
) {
  const { spaceId, versionId } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx

  const body = await parseBody(req, actionSchema)
  if (body instanceof NextResponse) return body

  const actor = {
    userId: ctx.principal.userId,
    email: ctx.principal.email ?? ctx.principal.userId,
    spaceId: ctx.resolved.spaceId,
    isAdmin: ctx.resolved.isAdmin,
  }

  if (body.action === 'revoke') {
    const result = await revokeVersion(versionId, { userId: actor.userId, email: actor.email }, body.reason ?? null)
    if (!result.ok) return bad(result.error, result.status)
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'review') {
    const result = await reviewSpaceVersion(versionId, body.decision, actor, body.note)
    if (!result.ok) return bad(result.error, result.status)
    const answer: ApprovalDecisionResponse = { version: result.version, upgraded: result.upgraded }
    return NextResponse.json(answer)
  }

  const result =
    body.action === 'list'
      ? await requestListing(versionId, actor, { note: body.note, license: body.license })
      : body.action === 'cosign'
        ? await cosignListing(versionId, { userId: actor.userId, email: actor.email }, body.license)
        : await withdrawListing(versionId, actor)
  if (!result.ok) return bad(result.error, result.status)
  const answer: ListingResponse = { version: result.version }
  return NextResponse.json(answer)
}
