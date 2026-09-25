import { NextRequest, NextResponse } from 'next/server'
import { getSessionInfo } from '@/lib/session'
import { toolClientOf } from '@/lib/tools/clientClass'
import { z } from 'zod'
import { requireAgentsAccess } from '@/lib/agents/route'
import { clearChat, listChatMessages, sendChatMessage } from '@/lib/agents/chat'
import { CHAT_PAGE_MAX, CHAT_TEXT_MAX } from '@/lib/agents/shared/chat'
import { handleApiError, parseBody } from '@/lib/api/route'

export const dynamic = 'force-dynamic'
// A turn may take CHAT_TURN_MS; the route's own ceiling sits a little above it.
export const maxDuration = 120

type Params = { params: Promise<{ spaceId: string; name: string }> }

const querySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(CHAT_PAGE_MAX).optional(),
})

/** GET — a page of the caller's thread with this agent, newest first. Mirrored as `ChatPage`. */
export async function GET(req: NextRequest, { params }: Params) {
  const { spaceId, name: raw } = await params
  const name = decodeURIComponent(raw)
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const { searchParams } = new URL(req.url)
  const query = querySchema.safeParse({ cursor: searchParams.get('cursor') ?? undefined, limit: searchParams.get('limit') ?? undefined })
  if (!query.success) return NextResponse.json({ error: 'bad query' }, { status: 400 })
  try {
    return NextResponse.json(await listChatMessages(ctx.principal.userId, spaceId, name, query.data))
  } catch (error) {
    return handleApiError(error, 'api.agents.chat.messages.failed')
  }
}

const sendSchema = z.object({ text: z.string().trim().min(1).max(CHAT_TEXT_MAX) })

/**
 * POST — one message, answered in this response: `{ userMessage, message }`.
 * The streaming form is `…/chat/stream`. Refusals carry a `reason` the phone
 * can word: `no_model`, `budget`, `busy`, `invalid_brief`, `rate`.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { spaceId, name: raw } = await params
  const name = decodeURIComponent(raw)
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const body = await parseBody(req, sendSchema)
  if (body instanceof NextResponse) return body
  try {
    const info = await getSessionInfo()
    const result = await sendChatMessage(ctx.principal, ctx.resolved, name, body.text, {
      client: info ? toolClientOf(info) : 'app',
    })
    if (!result.ok) return NextResponse.json({ error: result.message, reason: result.reason }, { status: result.status })
    return NextResponse.json({ userMessage: result.userMessage, message: result.message })
  } catch (error) {
    return handleApiError(error, 'api.agents.chat.send.failed')
  }
}

/** DELETE — forget the caller's thread with this agent. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { spaceId, name: raw } = await params
  const name = decodeURIComponent(raw)
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  try {
    return NextResponse.json({ cleared: await clearChat(ctx.principal.userId, spaceId, name) })
  } catch (error) {
    return handleApiError(error, 'api.agents.chat.clear.failed')
  }
}
