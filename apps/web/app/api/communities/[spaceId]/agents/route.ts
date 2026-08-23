import { NextRequest, NextResponse } from 'next/server'
import { requireAgentsAccess } from '@/lib/agents/route'
import { listAgents } from '@/lib/agents/service'

/**
 * The roster: every agent brief the caller can see, joined with its
 * activation, state row and last run, plus the folders of agents they sit
 * in. Members see the whole roster; the money (spend, budget) is admin-only
 * and stripped otherwise — that is the reason budget is not a note field.
 * Model keys are not here: they belong to the model connectors (/connectors).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const { resolved, principal } = ctx

  // No space timezone here any more: an agent's zone is part of its own
  // activation note, so there is no space-wide default for the roster to carry.
  const { agents, folders, heartbeatAt } = await listAgents(principal, resolved, { includeSpend: resolved.isAdmin })

  return NextResponse.json({
    agents: resolved.isAdmin ? agents : agents.map((a) => ({ ...a, spend: null })),
    folders,
    heartbeatAt,
    isAdmin: resolved.isAdmin,
    currentUserId: resolved.actor.id,
  })
}
