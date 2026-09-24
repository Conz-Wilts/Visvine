import { NextRequest, NextResponse } from 'next/server'
import { bad, requireAgentsAccess } from '@/lib/agents/route'
import { configureAgent } from '@/lib/agents/service'
import { agentConfigInput, configPatchOf } from '@/lib/agents/configInput'

/**
 * How an agent runs — its record (lib/agents/shared/agentConfig.ts). PUT a
 * partial `agentConfigInput`; each field keeps its own gate in
 * service.ts#configureAgent. Answers the record as saved.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ spaceId: string; name: string }> }) {
  const { spaceId, name: raw } = await params
  const name = decodeURIComponent(raw)
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const parsed = agentConfigInput.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? 'Invalid settings')
  const r = await configureAgent(ctx.principal, ctx.resolved, name, configPatchOf(parsed.data))
  if (!r.ok) return bad(r.error, r.status)
  return NextResponse.json({ ok: true, config: r.config })
}
