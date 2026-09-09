import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { bad, requireAgentsAccess } from '@/lib/agents/route'
import { spaceBudgetCents } from '@/lib/agents/runs'

/**
 * The space-wide monthly cap on what its agents may spend, and nothing else.
 * Admin-read and admin-write like the budget route.
 *
 * There is no bill to read here: what a space's provider keys were billed is
 * the provider's own account to show. Tokens are still metered per run —
 * agent_model_usage — because the cap is computed from them.
 *
 * GET answers `{ budgetMonthlyCents }`; PUT sets it (number or null), stored
 * in the space's featureConfig the way the machine quota is — no schema, no
 * deploy. The runner reads it through `spaceBudgetCents` before every run.
 */

async function admin(spaceId: string) {
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  if (!ctx.resolved.isAdmin) return bad('Admins only', 403)
  return ctx
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const ctx = await admin(spaceId)
  if (ctx instanceof Response) return ctx
  return NextResponse.json({ budgetMonthlyCents: await spaceBudgetCents(spaceId) })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const ctx = await admin(spaceId)
  if (ctx instanceof Response) return ctx
  const body = (await req.json().catch(() => null)) as { budgetMonthlyCents?: unknown } | null
  if (!body || !('budgetMonthlyCents' in body)) return bad('budgetMonthlyCents is required (number or null)')
  const v = body.budgetMonthlyCents
  if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
    return bad('budgetMonthlyCents must be a non-negative number or null')
  }
  const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { featureConfig: true } })
  if (!space) return bad('Unknown space', 404)
  const config = { ...((space.featureConfig ?? {}) as Record<string, unknown>) }
  if (v === null) delete config.agentBudgetMonthlyCents
  else config.agentBudgetMonthlyCents = Math.floor(v)
  await prisma.space.update({ where: { id: spaceId }, data: { featureConfig: config as object } })
  return NextResponse.json({ ok: true, budgetMonthlyCents: v === null ? null : Math.floor(v) })
}
