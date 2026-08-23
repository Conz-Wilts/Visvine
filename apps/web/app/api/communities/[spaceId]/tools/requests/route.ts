import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/api/route'
import { spaceAdminUserIds } from '@/lib/auth'
import { notify } from '@/lib/notifications/service'
import { getVersion } from '@/lib/tools/registry'
import { bad, requireToolsAccess } from '@/lib/tools/route'
import prisma from '@/lib/prisma'

const requestSchema = z.object({
  versionId: z.string().min(1),
  /** Why the space should run it — shown to the admins, optional. */
  message: z.string().max(1000).optional(),
})

/**
 * A member asking their space admins to install a marketplace Tool.
 *
 * This is the member-facing half of "only admins install": the marketplace is
 * open to every member (browsing a shared shelf is not a privilege), installing
 * writes into the space, and the gap between the two is a REQUEST — the same
 * shape as asking for note access (lib/notes/accessRequests.ts), and delivered
 * the same way, through the notification bell of everyone who can act on it.
 *
 * Deliberately no request table: the notification IS the request. It dedupes
 * per member+version while unread, names who asked and what for, and links the
 * admin straight to the marketplace where Install lives. An admin installing
 * (or deciding not to) resolves it by reading it — a second queue to groom
 * would be more system than the decision needs.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx

  const body = await parseBody(req, requestSchema)
  if (body instanceof NextResponse) return body

  const version = await getVersion(body.versionId)
  if (!version) return bad('No such tool version.', 404)
  if (version.status !== 'approved') return bad('Only an approved version can be requested.', 409)

  const installed = await prisma.appToolInstall.findFirst({
    where: { spaceId: ctx.resolved.spaceId, key: version.key },
    select: { id: true },
  })
  if (installed) return bad('This tool is already installed in this space.', 409)

  const admins = (await spaceAdminUserIds(ctx.resolved.spaceId)).filter(
    (id) => id !== ctx.principal.userId,
  )
  // An admin asking is not a request — they can install; and a space with no
  // OTHER admin to ask answers honestly rather than swallowing the ask.
  if (admins.length === 0) {
    return bad('There is no other admin to ask — you can install it yourself from this page.', 409)
  }

  const requester = ctx.principal.name || ctx.principal.email || 'A member'
  await notify(admins, {
    spaceId: ctx.resolved.spaceId,
    kind: 'tool_install_request',
    title: `${requester} asked to add ${version.title} to this space`,
    body: body.message?.trim()
      ? body.message.trim()
      : `${version.title} v${version.version} — open the marketplace to review its reach and install it.`,
    href: '/tools',
    // One open ask per member+tool: re-requesting while an admin hasn't read
    // the first one creates nothing. Keyed on `version.key` (the Tool's
    // marketplace identity across versions), so a new version shipping
    // doesn't multiply the same ask.
    dedupeKey: `tool_install_request:${ctx.principal.userId}:${version.key}`,
  })

  return NextResponse.json({ ok: true, notified: admins.length }, { status: 201 })
}
