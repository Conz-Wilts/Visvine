import { NextRequest, NextResponse } from 'next/server'
import { requireAgentsAccess } from '@/lib/agents/route'
import { agentOptions } from '@/lib/agents/options'

/**
 * The choices behind an agent's settings — providers and whether each has a
 * key, connectors, sibling agents, tool extras — for any member of the space.
 * Names and booleans only; see lib/agents/options.ts.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  return NextResponse.json(await agentOptions(spaceId, ctx.principal.userId))
}
