import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { bad, requireAgentsAccess } from '@/lib/agents/route'
import { subscribeToAgent, unsubscribeFromAgent } from '@/lib/agents/service'

const Settings = z.object({
  at: z.string().max(5).nullish(),
  timezone: z.string().max(64).nullish(),
  model: z.string().max(200).nullish(),
})

/**
 * Who the agent runs for — the brief's `for:` block. POST puts YOUR name down,
 * with your own time, zone and model when you give them — each fire then runs
 * once for you, as your principal (anyone who can read the brief may; the run
 * reaches only what they already reach). DELETE takes a name off: your own, or
 * anyone's if you can edit the agent (`{ userId }` in the body; omitted = you).
 * The list itself rides the agent GET.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ spaceId: string; name: string }> }) {
  const { spaceId, name: raw } = await params
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const settings = Settings.safeParse((await req.json().catch(() => null)) ?? {})
  if (!settings.success) return bad('Bad settings.', 400)
  const r = await subscribeToAgent(ctx.principal, ctx.resolved, decodeURIComponent(raw), settings.data)
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
