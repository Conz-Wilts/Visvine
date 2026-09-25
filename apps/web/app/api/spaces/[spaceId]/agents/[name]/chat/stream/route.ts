import { NextRequest, NextResponse } from 'next/server'
import { getSessionInfo } from '@/lib/session'
import { toolClientOf } from '@/lib/tools/clientClass'
import { z } from 'zod'
import { requireAgentsAccess } from '@/lib/agents/route'
import { sendChatMessage } from '@/lib/agents/chat'
import { CHAT_TEXT_MAX, CHAT_TURN_MS, type ChatStreamEvent } from '@/lib/agents/shared/chat'
import { parseBody } from '@/lib/api/route'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const sendSchema = z.object({ text: z.string().trim().min(1).max(CHAT_TEXT_MAX) })
const KEEPALIVE_MS = 15_000

/**
 * POST — one message, answered as a stream of what the turn does:
 * `data: {"type":"user"|"tool"|"tool_result"|"assistant"|"done"|"error", …}`
 * (lib/agents/shared/chat.ts#ChatStreamEvent), a `: keepalive` comment every
 * 15 s, and the stream's own clock a little past CHAT_TURN_MS.
 *
 * The turn is not tied to this response: a phone that goes away mid-answer
 * finds the finished message on its next read of the thread. Only the
 * writing stops. The refusals a phone should word (no model, budget, busy)
 * would end the stream at once, so they are answered as ordinary JSON
 * statuses before it opens — which needs the turn's preflight to run first;
 * the service runs it inside the same call, so the stream carries an `error`
 * event for them instead, and the client treats that like a refusal.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ spaceId: string; name: string }> }) {
  const { spaceId, name: raw } = await params
  const name = decodeURIComponent(raw)
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const body = await parseBody(req, sendSchema)
  if (body instanceof NextResponse) return body
  const info = await getSessionInfo()
  const client = info ? toolClientOf(info) : 'app'

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const write = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          closed = true
        }
      }
      const send = (event: ChatStreamEvent) => write(`data: ${JSON.stringify(event)}\n\n`)
      const close = () => {
        if (closed) return
        closed = true
        clearInterval(keepalive)
        clearTimeout(clock)
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
      write(': connected\n\n')
      const keepalive = setInterval(() => write(': keepalive\n\n'), KEEPALIVE_MS)
      const clock = setTimeout(close, CHAT_TURN_MS + 10_000)
      // A client abort stops the writing, never the turn.
      req.signal.addEventListener('abort', () => {
        closed = true
        clearInterval(keepalive)
        clearTimeout(clock)
      })

      void sendChatMessage(ctx.principal, ctx.resolved, name, body.text, { onEvent: send, client })
        .then((result) => {
          if (!result.ok) send({ type: 'error', reason: result.reason, message: result.message })
        })
        .catch((err) => {
          logger.error('api.agents.chat.stream.failed', { err, spaceId, name })
          send({ type: 'error', reason: 'error', message: 'The turn failed.' })
        })
        .finally(close)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
