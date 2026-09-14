import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { bad, requireAgentsAccess } from '@/lib/agents/route'
import { setBudget } from '@/lib/agents/service'
import { spendForMonth } from '@/lib/agents/runs'
import { microsToCents } from '@/lib/agents/budget'
import { AGENT_NAME_RE } from '@/lib/agents/config'

/**
 * The one agent fact that is NOT in a note: money. Admin-read and admin-write
 * — members see the roster, never the bill. GET returns the cap and this
 * month's spend; PUT sets the cap (`{ budgetMonthlyCents: number | null }`).
 */
async function admin(spaceId: string) {
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  if (!ctx.resolved.isAdmin) return bad('Admins only', 403)
  return ctx
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string; name: string }> }) {
  const { spaceId, name: raw } = await params
  const name = decodeURIComponent(raw)
  if (!AGENT_NAME_RE.test(name)) return bad('Bad agent name')
  const ctx = await admin(spaceId)
  if (ctx instanceof Response) return ctx
  const [state, month, spaceMonth] = await Promise.all([
    prisma.agentState.findUnique({ where: { agent_identity: { spaceId, name } }, select: { budgetMonthlyCents: true } }),
    spendForMonth(spaceId, name, new Date()),
    spendForMonth(spaceId, null, new Date()),
  ])
  return NextResponse.json({
    budgetMonthlyCents: state?.budgetMonthlyCents ?? null,
    spentMonthCents: microsToCents(month),
    spaceSpentMonthCents: microsToCents(spaceMonth),
  })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ spaceId: string; name: string }> }) {
  const { spaceId, name: raw } = await params
  const name = decodeURIComponent(raw)
  if (!AGENT_NAME_RE.test(name)) return bad('Bad agent name')
  const ctx = await admin(spaceId)
  if (ctx instanceof Response) return ctx
  const body = (await req.json().catch(() => null)) as { budgetMonthlyCents?: unknown } | null
  if (!body || !('budgetMonthlyCents' in body)) return bad('budgetMonthlyCents is required (number or null)')
  const v = body.budgetMonthlyCents
  if (v !== null && typeof v !== 'number') return bad('budgetMonthlyCents must be a number or null')
  const r = await setBudget(ctx.principal, ctx.resolved, name, v as number | null)
  return r.ok ? NextResponse.json({ ok: true }) : bad(r.error, r.status)
}
