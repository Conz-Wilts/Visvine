import { NextRequest, NextResponse } from 'next/server'
import { bindableSpace } from '@/lib/tools/bindable'
import { bad, requireToolsAccess } from '@/lib/tools/route'

/**
 * What this space can bind a Tool's slots to — its folders, types with their
 * fields, connectors with their recipes, agents — for the install sheet's
 * pickers. Admins only: binding is an admin's act, and the list names every
 * connector the space holds.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  if (!ctx.resolved.isAdmin) return bad('Only space admins can bind a tool.', 403)
  return NextResponse.json(await bindableSpace(spaceId))
}
