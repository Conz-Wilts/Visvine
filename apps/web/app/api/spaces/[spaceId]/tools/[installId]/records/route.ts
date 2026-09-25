import type { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { exportRows } from '@/lib/tools/collections'
import { bad, requireToolsAccess } from '@/lib/tools/route'

/**
 * `GET …/tools/<installId>/records` — an install's collection rows as JSON,
 * for the space's admins: each collection's rows with their times, never who
 * wrote them. What a space takes with it when it leaves a Tool behind.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string; installId: string }> }) {
  const { spaceId, installId } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  if (!ctx.resolved.isAdmin) return bad('Only this space’s admins export a tool’s data.', 403)
  const install = await prisma.appToolInstall.findFirst({ where: { id: installId, spaceId }, select: { slug: true } })
  if (!install) return bad('No such install.', 404)
  const collections = await exportRows(spaceId, installId)
  return new Response(JSON.stringify({ tool: install.slug, exportedAt: new Date().toISOString(), collections }, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${install.slug}-data.json"`,
      'Cache-Control': 'no-store',
    },
  })
}
