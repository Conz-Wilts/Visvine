import { NextRequest, NextResponse } from 'next/server'
import { requireAgentsAccess } from '@/lib/agents/route'
import { listChatAgents } from '@/lib/agents/chat'
import { handleApiError } from '@/lib/api/route'

/**
 * GET — Messages → Agents on the phone: every agent the caller can see here,
 * whether it can answer, and the caller's own thread with it (last message,
 * unread). Mirrored by the mobile clients' `ChatAgentRow`.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  try {
    return NextResponse.json({ agents: await listChatAgents(ctx.principal, ctx.resolved) })
  } catch (error) {
    return handleApiError(error, 'api.agents.chat.list.failed')
  }
}
