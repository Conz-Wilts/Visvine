import { NextRequest, NextResponse } from 'next/server'
import { aboutInstall } from '@/lib/tools/about'
import { bad, requireToolsAccess } from '@/lib/tools/route'

/**
 * `GET …/tools/<installId>/about` — the About view of an installed Tool
 * (lib/tools/about.ts). Every member who may open the space's Tools reads it:
 * a Tool in the rail is not a secret from the people it runs for.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ spaceId: string; installId: string }> },
) {
  const { spaceId, installId } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const about = await aboutInstall(spaceId, installId)
  if (!about) return bad('No such install.', 404)
  return NextResponse.json({ about })
}
