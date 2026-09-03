import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { bad, requireAgentsAccess } from '@/lib/agents/route'
import { rollupUsage } from '@/lib/agents/shared/usage'
import { monthBounds } from '@/lib/agents/budget'
import { spaceBudgetCents } from '@/lib/agents/runs'

/**
 * The space's model bill: agent_model_usage rows for the last six months,
 * shaped per month with by-model and by-agent breakdowns
 * (lib/agents/shared/usage.ts), plus the space-wide monthly cap. Admin-read
 * and admin-write like the budget route — members see the roster, never the
 * bill. Rendered by the Usage console section and, filtered to one provider,
 * by a model's own page as its Usage section.
 *
 * PUT sets the cap (`{ budgetMonthlyCents: number | null }`), stored in the
 * space's featureConfig the way the machine quota is — no schema, no deploy.
 * The runner reads it through `spaceBudgetCents` before every run.
 */
const MONTHS_SHOWN = 6

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

  const { start } = monthBounds(new Date())
  const since = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - (MONTHS_SHOWN - 1), 1))
  const [rows, budgetMonthlyCents] = await Promise.all([
    prisma.agentModelUsage.findMany({
      where: { spaceId, month: { gte: since } },
      select: {
        month: true,
        name: true,
        model: true,
        runs: true,
        promptTokens: true,
        completionTokens: true,
        costMicros: true,
        unpricedRuns: true,
      },
    }),
    spaceBudgetCents(spaceId),
  ])
  return NextResponse.json({ months: rollupUsage(rows), budgetMonthlyCents, currentMonth: start.toISOString() })
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
