import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionInfo } from '@/lib/session'
import { toolClientOf, TOOL_PHONE_REFUSAL } from '@/lib/tools/clientClass'
import { sendBuilderMessage, type BuilderStreamEvent } from '@/lib/tools/builder'
import { requireToolsAccess } from '@/lib/tools/route'
import { CHAT_TEXT_MAX } from '@/lib/agents/shared/chat'
import { parseBody } from '@/lib/api/route'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 240

const sendSchema = z.object({
  text: z.string().trim().min(1).max(CHAT_TEXT_MAX),
  /** The Tool the Workbench has open, when there is one. */
  tool: z.string().max(80).nullish(),
})
const KEEPALIVE_MS = 15_000
/** The builder's turn clock (lib/tools/builder.ts) plus a margin, and never the runtime's ceiling. */
const STREAM_MS = 200_000

/**
 * POST — one message to the Tool builder, answered as a stream of what the
 * turn does: agent chat's events (`user`, `tool`, `tool_result`, `assistant`,
 * `done`, `error`) plus `workbench { tool }` whenever a call created or wrote
 * a Tool, so the Workbench reloads its preview as the files land. The turn is
 * not tied to this response; a client that goes away finds the answer on its
 * next read of the thread.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const info = await getSessionInfo()
  // Tools are built and run on the web and in the desktop app, never in the phone apps.
  if (info && toolClientOf(info) === 'mobile') return NextResponse.json({ error: TOOL_PHONE_REFUSAL }, { status: 403 })
  const body = await parseBody(req, sendSchema)
  if (body instanceof NextResponse) return body

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
      const send = (event: BuilderStreamEvent) => write(`data: ${JSON.stringify(event)}\n\n`)
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
      const clock = setTimeout(close, STREAM_MS)
      req.signal.addEventListener('abort', () => {
        closed = true
        clearInterval(keepalive)
        clearTimeout(clock)
      })

      void sendBuilderMessage(ctx.principal, ctx.resolved, body.text, { onEvent: send, tool: body.tool ?? null })
        .then((result) => {
          if (!result.ok) send({ type: 'error', reason: result.reason, message: result.message })
        })
        .catch((err) => {
          logger.error('api.tools.builder.stream.failed', { err, spaceId })
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
