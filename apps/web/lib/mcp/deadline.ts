/**
 * Nothing served from this endpoint may hold a request open indefinitely.
 *
 * The runtime's ceiling is Cloud Run's `--timeout`, which has to stay at 1800s
 * because the agent tick awaits the runs it dispatches. That ceiling is not a
 * timeout anyone chose for MCP: a request that reaches it has been BILLED for
 * half an hour of instance time, and an instance held by an idle connection is
 * an instance the autoscaler cannot retire.
 *
 * Two things happen here, and they are separate concerns:
 *
 * 1. **The body is settled before the response is returned.** The SDK answers
 *    a tool call over `text/event-stream` and closes the stream as soon as the
 *    result is written — but a chunked event-stream has no length, so the
 *    connection stays open (and billed) until the CLIENT hangs up. Reading the
 *    stream to its end here and handing back the bytes gives the response a
 *    Content-Length, which is what actually ends the exchange. The framing the
 *    client sees is unchanged: the same SSE bytes, under the same
 *    content-type.
 * 2. **A deadline bounds the wait.** A handler that never resolves is answered
 *    with a JSON-RPC error instead of being left to the platform.
 *
 * Both are outside the auth wrappers, so a 401 challenge settles the same way
 * a tool result does.
 */
import { logger } from '@/lib/logger'

/**
 * Longest an MCP exchange may hold its connection.
 *
 * Every action reachable through the gateway is bounded well inside this: a
 * connector run is capped at SANDBOX_LIMITS.timeoutMs (120s at most) and
 * `run_agent` waits RUN_AWAIT_MS for its dispatch before handing back a run id
 * to watch. Two minutes is therefore slack, not a budget — reaching it means
 * something is hung, and a hung request should end as an error a client can
 * read rather than as a half-hour of instance time.
 */
export const MCP_REQUEST_DEADLINE_MS = 120_000

/**
 * Bytes one response may buffer. The gateway answers in kilobytes; the cap is
 * here so a pathological body cannot trade a held connection for a held heap.
 */
const MAX_BODY_BYTES = 8 * 1024 * 1024

const JSONRPC_INTERNAL_ERROR = -32603

function deadlineResponse(reason: 'timeout' | 'too_large'): Response {
  const message =
    reason === 'timeout'
      ? `The request did not complete within ${Math.round(MCP_REQUEST_DEADLINE_MS / 1000)}s and was ended by the server.`
      : 'The response was too large to return.'
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: JSONRPC_INTERNAL_ERROR, message }, id: null }), {
    status: 504,
    headers: { 'content-type': 'application/json' },
  })
}

/** Read a body to its end, or give up. Cancels the stream either way. */
async function settleBody(body: ReadableStream<Uint8Array>, deadlineMs: number): Promise<ArrayBuffer | 'timeout' | 'too_large'> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let expired = false
  const timer = setTimeout(() => {
    expired = true
    void reader.cancel().catch(() => {})
  }, deadlineMs)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {})
        return 'too_large'
      }
      chunks.push(value)
    }
  } catch {
    // A cancelled read throws; which case it was is `expired`.
  } finally {
    clearTimeout(timer)
  }
  if (expired) return 'timeout'
  const buffer = new ArrayBuffer(size)
  const out = new Uint8Array(buffer)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return buffer
}

/**
 * Wrap an MCP handler so every response it returns is finite and bounded.
 * `deadlineMs` is injectable for the tests; nothing else passes it.
 */
export function withRequestDeadline(
  handler: (req: Request) => Response | Promise<Response>,
  deadlineMs: number = MCP_REQUEST_DEADLINE_MS,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const started = Date.now()
    const res = await handler(req)
    if (!res.body) return res
    const settled = await settleBody(res.body, Math.max(0, deadlineMs - (Date.now() - started)))
    if (settled === 'timeout' || settled === 'too_large') {
      // Warn, not error: the request was answered as designed. It is the app
      // working the way this file exists to make it work.
      logger.warn('mcp.request.unsettled', { reason: settled, elapsedMs: Date.now() - started })
      return deadlineResponse(settled)
    }
    return new Response(settled, { status: res.status, statusText: res.statusText, headers: res.headers })
  }
}
