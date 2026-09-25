import type { NextRequest } from 'next/server'
import { bad, requireToolsAccess } from '@/lib/tools/route'
import { exportWorkingCopy } from '@/lib/tools/package'

/**
 * `GET …/tools/authoring/<name>/export` — a working copy as a `.vvtool`
 * package, as the reader may see it. Never signed; names no space.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string; name: string }> }) {
  const { spaceId, name: raw } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const result = await exportWorkingCopy(ctx.principal, ctx.resolved, decodeURIComponent(raw))
  if (!result.ok) return bad(result.error, result.status)
  return new Response(Buffer.from(result.bytes), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Cache-Control': 'no-store',
      'X-Visvine-Package-Digest': result.digest,
    },
  })
}
