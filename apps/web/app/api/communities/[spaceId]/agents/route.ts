import { NextRequest, NextResponse } from 'next/server'
import { requireAgentsAccess } from '@/lib/agents/route'
import { listAgents } from '@/lib/agents/service'

/**
 * The space's agent roster — every brief the caller can see, with its
 * activation, schedule and last run. The console's Agents section reads this;
 * an individual agent (brief text, runs, spend) is the `[name]` route beside
 * it.
 *
 * Spend rides `includeSpend` on the admin path only: money is admin-read
 * while a brief is member-read, so a member gets the same roster without it
 * rather than a different endpoint.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const { resolved, principal } = ctx
  const { agents, heartbeatAt } = await listAgents(principal, resolved, { includeSpend: resolved.isAdmin })
  return NextResponse.json({ agents, heartbeatAt, isAdmin: resolved.isAdmin })
}
