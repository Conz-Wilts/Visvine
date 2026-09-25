import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/api/route'
import { installVersion, listInstalls } from '@/lib/tools/installs'
import { bad, requireToolsAccess } from '@/lib/tools/route'
import type { InstallCreatedResponse, InstallSummary, InstallsResponse } from '@/lib/tools/api'

/**
 * The Tools this space runs — the marketplace's Installed tab and the console.
 *
 * Every member sees the list (a Tool in the rail is not a secret from the people
 * it renders for), but a waiting upgrade is stripped for non-admins: it is an
 * admin's decision to make, and showing "a new version is available" to someone
 * who cannot apply it is noise with a perimeter diff attached.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx

  const installs = await listInstalls(spaceId)
  const visible: InstallSummary[] = ctx.resolved.isAdmin
    ? installs
    : installs.map((install) => ({ ...install, pendingVersion: null }))

  const body: InstallsResponse = { installs: visible, isAdmin: ctx.resolved.isAdmin }
  return NextResponse.json(body)
}

const installSchema = z.object({
  versionId: z.string().min(1),
  /** Defaults to the Tool's own name, de-duplicated against this space. */
  slug: z.string().min(1).max(63).optional(),
  /** The admin's answer to the type surfaces the Tool declared; `none` leaves one. */
  typeClaims: z.record(z.string(), z.enum(['page', 'tab', 'none'])).optional(),
  /** On the rail, or tucked into More. */
  placement: z.enum(['rail', 'more']).optional(),
})

/**
 * Install an approved version (admin).
 *
 * Unmet requirements do not refuse: the Tool installs, `install.degraded` is
 * true and the checklist rides on `install.requirements`, which is the brief's
 * rule. What the caller does have to read back are `conflicts` — `page` claims
 * another install already owns — and `downgraded` — `page` claims on a built-in
 * type, which become tabs, because built-in pages stay built in.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  if (!ctx.resolved.isAdmin) return bad('Only space admins can install a tool.', 403)

  const body = await parseBody(req, installSchema)
  if (body instanceof NextResponse) return body

  const result = await installVersion(
    spaceId,
    body.versionId,
    { userId: ctx.principal.userId, email: ctx.principal.email },
    { slug: body.slug, typeClaims: body.typeClaims, placement: body.placement },
  )
  if (!result.ok) return bad(result.error, result.status)

  const answer: InstallCreatedResponse = {
    install: result.install,
    conflicts: result.conflicts,
    downgraded: result.downgraded,
  }
  return NextResponse.json(answer, { status: 201 })
}
