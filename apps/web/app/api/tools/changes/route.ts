import { NextRequest, NextResponse } from 'next/server'
import { requireToolSession } from '@/lib/tools/route'
import { subscribeChanges } from '@/lib/notes/changes'
import { changedPathsFor } from '@/lib/tools/changes'
import { resolveBridgeTarget } from '@/lib/tools/target'
import { MAX_STREAMS_PER_USER, streamCounter } from '@/lib/tools/streamLimit'
import { subscribeVerdicts } from '@/lib/tools/verdicts'

/**
 * `GET /api/tools/changes?target=<BridgeTarget JSON>` — an SSE stream of
 * "these note paths changed" for one Tool frame, the live-data half of the
 * bridge. Opened by the HOST page (features/tools ToolFrame) with the viewer's
 * own cookie session, exactly as the bridge is called; the frame itself is
 * cookie-less and cross-site and cannot reach it.
 *
 * The target is resolved once, the same way `POST /api/tools/bridge` does it,
 * so a viewer who may not use the Tool never subscribes; each event is then
 * filtered by `changedPathsFor` (perimeter + viewer grants). Nothing but paths
 * ever crosses — the frame re-reads through the bridge.
 *
 * Best-effort, per-process: see lib/notes/changes.ts. The stream also closes
 * itself after `MAX_STREAM_MS`; EventSource reconnects, which is how the
 * target gets re-resolved (a disabled install, a revoked membership) without
 * every event paying for a DB round trip. Events within `COALESCE_MS` of each
 * other are batched into one message.
 *
 * One person holds at most `MAX_STREAMS_PER_USER` open streams per process
 * (lib/tools/streamLimit.ts); the next is refused with 429 rather than the
 * oldest being cut, and the slot is given back on close or abort.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_STREAM_MS = 5 * 60_000
const HEARTBEAT_MS = 20_000
const COALESCE_MS = 150

export async function GET(req: NextRequest) {
  const caller = await requireToolSession()
  if (caller instanceof Response) return caller
  const { session, client } = caller

  const raw = req.nextUrl.searchParams.get('target')
  let target: unknown = null
  try {
    target = raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    target = null
  }
  const resolved = await resolveBridgeTarget(session, target, undefined, client)
  if ('code' in resolved) {
    return NextResponse.json({ ok: false, error: resolved }, { status: resolved.code === 'forbidden' ? 403 : 400 })
  }

  const streams = streamCounter()
  const userId = session.userId
  if (!streams.acquire(userId)) {
    return NextResponse.json(
      { ok: false, error: { code: 'too_many_streams', message: `At most ${MAX_STREAMS_PER_USER} change streams may be open at once.` } },
      { status: 429, headers: { 'Retry-After': '5' } },
    )
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let pending = new Set<string>()
      let flushTimer: ReturnType<typeof setTimeout> | null = null

      const write = (text: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          cleanup()
        }
      }
      const flush = () => {
        flushTimer = null
        if (pending.size === 0) return
        const paths = Array.from(pending)
        pending = new Set()
        write(`event: changed\ndata: ${JSON.stringify({ paths })}\n\n`)
      }

      const unsubscribe = subscribeChanges(resolved.spaceId, (change) => {
        for (const path of changedPathsFor(resolved, change)) pending.add(path)
        if (pending.size > 0 && flushTimer === null) flushTimer = setTimeout(flush, COALESCE_MS)
      })
      // A verdict moved on this Tool (lib/tools/verdicts.ts): say so and end the
      // stream. The host re-checks the target, which is what decides.
      const key = 'key' in resolved.install ? resolved.install.key : null
      const unsubscribeVerdicts = subscribeVerdicts((event) => {
        const mine =
          (event.versionId !== undefined && event.versionId === resolved.versionId) ||
          (event.key !== undefined && event.key === key)
        if (!mine) return
        write('event: verdict\ndata: {}\n\n')
        cleanup()
      })
      const heartbeat = setInterval(() => write(': keepalive\n\n'), HEARTBEAT_MS)
      const lifetime = setTimeout(() => cleanup(), MAX_STREAM_MS)

      function cleanup() {
        if (closed) return
        closed = true
        streams.release(userId)
        clearInterval(heartbeat)
        clearTimeout(lifetime)
        if (flushTimer !== null) clearTimeout(flushTimer)
        unsubscribe()
        unsubscribeVerdicts()
        try {
          controller.close()
        } catch {
          // already closed by the client
        }
      }

      write(': connected\n\n')
      req.signal.addEventListener('abort', cleanup)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
