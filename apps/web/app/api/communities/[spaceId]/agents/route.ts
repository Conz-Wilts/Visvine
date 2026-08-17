import { NextRequest, NextResponse } from 'next/server'
import { requireAgentsAccess } from '@/lib/agents/route'
import { listAgents } from '@/lib/agents/service'
import { PROVIDERS } from '@/lib/agents/registry'
import prisma from '@/lib/prisma'

/**
 * The roster: every agent brief the caller can see, joined with its
 * activation, state row and last run. Members see the whole roster; the
 * money (spend, budget) is admin-only and stripped otherwise — that is the
 * reason budget is not a note field.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const { resolved, principal } = ctx

  const [{ agents, heartbeatAt }, space, keys] = await Promise.all([
    listAgents(principal, resolved, { includeSpend: resolved.isAdmin }),
    prisma.space.findUnique({ where: { id: spaceId }, select: { timezone: true, agentConfig: true } }),
    resolved.isAdmin
      ? prisma.connectorSecret.findMany({
          where: { spaceId, name: { startsWith: 'MODEL_KEY_' } },
          select: { name: true, updatedAt: true },
        })
      : Promise.resolve([]),
  ])

  return NextResponse.json({
    agents: resolved.isAdmin ? agents : agents.map((a) => ({ ...a, spend: null })),
    heartbeatAt,
    isAdmin: resolved.isAdmin,
    currentUserId: resolved.actor.id,
    spaceTimezone: space?.timezone ?? null,
    providers: PROVIDERS.map((p) => ({ id: p.id, label: p.label, keySecret: p.keySecret, models: p.models.map((m) => ({ id: m.id, label: m.label })) })),
    modelKeys: keys.map((k) => ({ name: k.name, updatedAt: k.updatedAt })),
  })
}
