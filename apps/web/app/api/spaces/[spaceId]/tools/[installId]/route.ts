import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/api/route'
import {
  applyUpgrade,
  refreshRequirements,
  setInstallEnabled,
  setTypeClaims,
  uninstall,
  type InstallUpdateResult,
} from '@/lib/tools/installs'
import { bad, requireToolsAccess } from '@/lib/tools/route'
import type { InstallUpdatedResponse } from '@/lib/tools/api'

const patchSchema = z
  .object({
    /** The admin's on/off switch. The rail key stays put. */
    enabled: z.boolean().optional(),
    /** Which declared types this install owns, and how. */
    typeClaims: z.record(z.string(), z.enum(['page', 'tab'])).optional(),
    /** Move onto the approved version waiting for this install. */
    applyUpgrade: z.literal(true).optional(),
    /** Re-check requirements against the space as it stands now. */
    recheck: z.literal(true).optional(),
  })
  .refine((body) => Object.values(body).filter((value) => value !== undefined).length === 1, {
    message: 'Send exactly one of enabled, typeClaims, applyUpgrade or recheck.',
  })

/**
 * The four things an admin does to an install, one per request.
 *
 * One action at a time on purpose: each of these is a separate decision with its
 * own refusals (a claim conflict, a vanished upgrade offer), and a request that
 * enabled a Tool AND took its type page would have no honest single status code.
 *
 * `recheck` is the odd one — `refreshRequirements` re-checks the whole space in
 * one pass, so the answer carries every install alongside this one. It is
 * addressed per-install because that is where the degraded banner and its
 * "Re-check" button live.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string; installId: string }> },
) {
  const { spaceId, installId } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  if (!ctx.resolved.isAdmin) return bad('Only space admins can change an installed tool.', 403)

  const body = await parseBody(req, patchSchema)
  if (body instanceof NextResponse) return body
  const actor = { userId: ctx.principal.userId, email: ctx.principal.email }

  if (body.recheck) {
    const refreshed = await refreshRequirements(spaceId, actor)
    if (!refreshed.ok) return bad(refreshed.error, refreshed.status)
    const install = refreshed.installs.find((row) => row.id === installId)
    if (!install) return bad('No such install.', 404)
    const rechecked: InstallUpdatedResponse = { install, installs: refreshed.installs }
    return NextResponse.json(rechecked)
  }

  let result: InstallUpdateResult
  if (body.enabled !== undefined) {
    result = await setInstallEnabled(spaceId, installId, actor, body.enabled)
  } else if (body.typeClaims) {
    result = await setTypeClaims(spaceId, installId, actor, body.typeClaims)
  } else {
    result = await applyUpgrade(spaceId, installId, actor)
  }
  if (!result.ok) return bad(result.error, result.status)

  const answer: InstallUpdatedResponse = { install: result.install }
  return NextResponse.json(answer)
}

/**
 * Uninstall: the row, and the Tool's rail key out of `order`/`more`/`adminOnly`,
 * in one transaction. The Tool's own stored state goes with it; context notes it
 * wrote are the space's and stay.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ spaceId: string; installId: string }> },
) {
  const { spaceId, installId } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  if (!ctx.resolved.isAdmin) return bad('Only space admins can uninstall a tool.', 403)

  const result = await uninstall(spaceId, installId, {
    userId: ctx.principal.userId,
    email: ctx.principal.email,
  })
  if (!result.ok) return bad(result.error, result.status)
  return NextResponse.json({ ok: true })
}
