import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/api/route'
import {
  reviewSpaceVersion,
  submitToMarketplace,
  withdrawFromMarketplace,
} from '@/lib/tools/registry'
import { bad, requireToolsAccess } from '@/lib/tools/route'
import { revokeVersion } from '@/lib/tools/verdicts'
import type { ApprovalDecisionResponse, ListingResponse } from '@/lib/tools/api'

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('review'),
    decision: z.enum(['approved', 'rejected']),
    note: z.string().max(4000).optional(),
  }),
  z.object({ action: z.literal('list'), note: z.string().max(4000).optional() }),
  z.object({ action: z.literal('unlist') }),
  z.object({ action: z.literal('revoke'), reason: z.string().max(500).optional() }),
])

/**
 * The decisions a space admin makes about a version of their own Tool.
 *
 * `review` is the update queue's verdict — approving is what makes the code
 * installable here and offers it to this space's existing installs. `revoke`
 * pulls an approved version back: it stops everywhere it runs at its next
 * bridge call (lib/tools/verdicts.ts). `list` and `unlist` are the
 * marketplace, and they are deliberately a SEPARATE act on a version that is
 * already approved: publishing ships a Tool to the people who wrote it, and
 * asking the world to run it is a different sentence with a different
 * reviewer at the end of it.
 *
 * Every gate is the library's — the routes hand it the actor and return the
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
      ? await submitToMarketplace(versionId, actor, { note: body.note })
      : await withdrawFromMarketplace(versionId, actor)
  if (!result.ok) return bad(result.error, result.status)
  const answer: ListingResponse = { version: result.version }
  return NextResponse.json(answer)
}
