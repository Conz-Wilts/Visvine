import { NextRequest, NextResponse } from 'next/server'
import { bad, requireAgentsAccess } from '@/lib/agents/route'
import { subscribeToAgent, unsubscribeFromAgent } from '@/lib/agents/service'

/**
 * The agent's run-for list. POST puts YOUR name down — each fire then runs
 * once for you, as your principal (anyone who can read the brief may; the run
 * reaches only what they already reach). DELETE takes a name off: your own, or
 * anyone's if you are a space admin (`{ userId }` in the body; omitted = you).
 * The list itself rides the agent GET.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ spaceId: string; name: string }> }) {
  const { spaceId, name: raw } = await params
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const r = await subscribeToAgent(ctx.principal, ctx.resolved, decodeURIComponent(raw))
  return r.ok ? NextResponse.json({ ok: true }) : bad(r.error, r.status)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ spaceId: string; name: string }> }) {
  const { spaceId, name: raw } = await params
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const body = (await req.json().catch(() => null)) as { userId?: unknown } | null
  const userId = typeof body?.userId === 'string' && body.userId ? body.userId : ctx.principal.userId
  const r = await unsubscribeFromAgent(ctx.principal, ctx.resolved, decodeURIComponent(raw), userId)
  return r.ok ? NextResponse.json({ ok: true }) : bad(r.error, r.status)
}
