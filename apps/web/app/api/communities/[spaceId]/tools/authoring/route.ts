import { NextRequest, NextResponse } from 'next/server'
import { listAuthoredTools } from '@/lib/tools/service'
import { requireToolsAccess } from '@/lib/tools/route'
import type { AuthoredToolSummary, AuthoredToolsResponse } from '@/lib/tools/api'

/**
 * The working copies authored in this space — the marketplace's Mine tab.
 *
 * Members author, so this is a member read, and it is narrowed by the caller's
 * own grants: `listAuthoredTools` reads through the principal's visible vault,
 * so a Tool in a folder you cannot see is not on your roster. A Tool whose
 * config does not parse still lists, carrying its error — a broken Tool the
 * author cannot see is a Tool they cannot fix.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx

  const tools: AuthoredToolSummary[] = await listAuthoredTools(ctx.principal, ctx.resolved)
  const body: AuthoredToolsResponse = { tools }
  return NextResponse.json(body)
}
