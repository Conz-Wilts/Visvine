import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/api/route'
import { deleteTool, describeAuthoredTool, toolRequirementsInSpace } from '@/lib/tools/service'
import { publishTool, toolKey, versionHistory } from '@/lib/tools/registry'
import { bad, requireToolsAccess } from '@/lib/tools/route'
import { readVisible, writeGated } from '@/lib/notes/contextService'
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import { toolIndexPath } from '@/lib/tools/config'
import { toolFolderIn } from '@/lib/tools/location'
import prisma from '@/lib/prisma'
import { principalCanWrite } from '@/lib/notes/shared/permissions'
import type {
  AuthoredToolDetail,
  AuthoredToolView,
  PublishBlockedResponse,
  PublishResponse,
} from '@/lib/tools/api'

/**
 * One working copy: config, the author's three files (sources unwrapped out of
 * their fenced notes), the build the compile-on-write hook last derived, what
 * this space fails to satisfy of the declared reach, and every version ever
 * published from it. This is what the author page and the preview header read.
 *
 * The last two ride along rather than sitting behind requests of their own: an
 * author opening their Tool always wants all four, and the checklist and the
 * publication trail are each one query.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ spaceId: string; name: string }> },
) {
  const { spaceId, name: raw } = await params
  const name = decodeURIComponent(raw)
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx

  const tool = await describeAuthoredTool(ctx.principal, ctx.resolved, name)
  if (!tool) return bad('Tool not found', 404)

  const key = toolKey(ctx.resolved.spaceId, name)
  const [requirements, versions, install] = await Promise.all([
    // Null when the config doesn't parse: there is no declared reach to check,
    // and an empty checklist would read as "nothing missing".
    tool.config
      ? toolRequirementsInSpace(ctx.principal, ctx.resolved, tool.config.perimeter)
      : null,
    // Keyed on the RESOLVED space, which is what publish stamps on the row —
    // the URL segment may be a spelling of it that never reaches the registry.
    versionHistory(key),
    prisma.appToolInstall.findUnique({
      where: { app_tool_install_identity: { spaceId: ctx.resolved.spaceId, key } },
      select: { id: true },
    }),
  ])
  const canEdit = principalCanWrite(ctx.principal, tool.path)

  const body: AuthoredToolView = { tool, requirements, versions, canEdit, installId: install?.id ?? null }
  return NextResponse.json(body)
}

const actionSchema = z.object({
  action: z.literal('publish'),
  note: z.string().max(4000).optional(),
  /** The author's "what changed" — shown on the marketplace card and the version history. */
  releaseNotes: z.string().max(4000).optional(),
})

/**
 * Publish the working copy as the next version — into THIS SPACE.
 *
 * Not admin-gated here, and that is the change the whole surface turns on: a
 * member publishing queues the version for their space's admins (the update
 * queue), an admin publishing approves as they publish, and neither reaches the
 * marketplace. Offering it to other spaces is a separate call on the version
 * itself (`…/tools/versions/<id>` with `action: 'list'`).
 *
 * A Tool that does not compile is refused HERE, with the build attached, rather
 * than after `publishTool` has read the same row again: the author asked to ship
 * something broken and the diagnostics are the answer, not a sentence about
 * them. Everything else — who may publish, superseding an earlier submission, a
 * denied `version:` bump — is the library's to decide.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string; name: string }> },
) {
  const { spaceId, name: raw } = await params
  const name = decodeURIComponent(raw)
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx

  const body = await parseBody(req, actionSchema)
  if (body instanceof NextResponse) return body

  const tool: AuthoredToolDetail | null = await describeAuthoredTool(ctx.principal, ctx.resolved, name)
  if (!tool) return bad('Tool not found', 404)
  if (tool.build && !tool.build.ok) {
    const blocked: PublishBlockedResponse = {
      error: `${name} does not compile — fix it and publish again.`,
      build: tool.build,
    }
    return NextResponse.json(blocked, { status: 409 })
  }

  const result = await publishTool(ctx.principal, ctx.resolved, name, {
    note: body.note,
    releaseNotes: body.releaseNotes,
  })
  if (!result.ok) return bad(result.error, result.status)

  const answer: PublishResponse = { version: result.version, warning: result.warning }
  return NextResponse.json(answer, { status: 201 })
}

const shareSchema = z.object({
  /** `'none'`, `'all'` (every sub-space) or a list of sub-space ids. */
  share: z.union([z.literal('none'), z.literal('all'), z.array(z.string().min(1)).max(200)]),
})

/**
 * Share the Tool with the space's sub-spaces — an admin's act, written as
 * `share:` on the index note so the projection installs it there
 * (lib/tools/share.ts). Through the gated write, so it is a note edit like any
 * other: audited, projected, and refused where the caller may not write.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string; name: string }> },
) {
  const { spaceId, name: raw } = await params
  const name = decodeURIComponent(raw)
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  if (!ctx.resolved.isAdmin) return bad('Only space admins can share a tool with sub-spaces.', 403)

  const body = await parseBody(req, shareSchema)
  if (body instanceof NextResponse) return body

  const path = toolIndexPath(name, await toolFolderIn(spaceId, name))
  const content = await readVisible(ctx.principal, ctx.resolved, path)
  if (content === null) return bad('Tool not found', 404)

  const fm = parseFrontmatter(content)
  if (body.share === 'none') delete fm.share
  else if (body.share === 'all') fm.share = 'all'
  else {
    const ids = [...new Set(body.share.map((id) => id.trim()).filter(Boolean))]
    const rooms = await prisma.space.findMany({ where: { parentId: ctx.resolved.spaceId, id: { in: ids } }, select: { id: true } })
    if (rooms.length !== ids.length) return bad('Share names a sub-space this space does not have')
    if (ids.length === 0) delete fm.share
    else fm.share = ids
  }
  const written = await writeGated(ctx.principal, ctx.resolved, path, joinFrontmatter(fm, splitFrontmatter(content).body))
  if (written.status === 'denied') return bad(written.reason, 403)

  const tool = await describeAuthoredTool(ctx.principal, ctx.resolved, name)
  return NextResponse.json({ tool })
}

/**
 * Delete the working copy — notes, folder, node, build, and (admin only) this
 * space's install. Published versions in the registry survive on purpose: they
 * are immutable snapshots other spaces may be running.
 *
 * Not admin-gated here, mirroring create: the service holds it to the note
 * store's own removal bar (admin, the author, or a full-access member), and
 * refuses a non-admin whose Tool is still installed in this space.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ spaceId: string; name: string }> },
) {
  const { spaceId, name: raw } = await params
  const name = decodeURIComponent(raw)
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx

  const result = await deleteTool(ctx.principal, ctx.resolved, name)
  if (!result.ok) return bad(result.error, result.status)
  return NextResponse.json({ ok: true })
}
