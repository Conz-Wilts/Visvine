import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { deleteToolIcon, writeToolFile, type WriteToolFileResult } from '@/lib/tools/service'
import { requireToolsAccess } from '@/lib/tools/route'
import { ICON_MAX_BYTES } from '@/lib/tools/iconSvg'

/**
 * A Tool's own rail glyph: `PUT` to set it, `DELETE` to fall back to a built-in.
 *
 * This is the ONLY HTTP door to a Tool's sources — everything else an author
 * writes goes over MCP, because everything else is code and a coding agent
 * writes it. An icon is the exception: it comes off someone's disk as a file,
 * and asking a person to paste SVG markup at an agent to get a picture into
 * their sidebar would be a silly way to do it.
 *
 * The body is the SVG's TEXT, not a multipart upload. The client reads the
 * chosen `.svg` file and posts its contents, which keeps this route a plain JSON
 * endpoint and keeps the "is this actually an icon" decision in one place:
 * `writeToolFile` stores it, the build sanitizes it (lib/tools/iconSvg.ts), and
 * a rejected icon comes back as a build error the author reads like any other.
 *
 * Authorization is the note gate, not a role: `writeToolFile`/`deleteToolIcon`
 * go through `writeDenialFull` on the icon's own path, so whoever may write into
 * this Tool's folder may set its icon, and nobody else can.
 */

const bodySchema = z.object({
  /** The SVG file's contents. Validated properly by the build, not here. */
  svg: z.string().min(1).max(ICON_MAX_BYTES),
})

type RouteParams = { params: Promise<{ spaceId: string; name: string }> }

function respond(result: WriteToolFileResult) {
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ path: result.path, build: result.build })
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { spaceId, name } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Send the SVG's contents as \`svg\` (under ${Math.round(ICON_MAX_BYTES / 1024)}KB).` },
      { status: 400 },
    )
  }

  return respond(await writeToolFile(ctx.principal, ctx.resolved, name, 'icon.svg', parsed.data.svg))
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { spaceId, name } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx

  return respond(await deleteToolIcon(ctx.principal, ctx.resolved, name))
}
