// Nothing served from /api/mcp may hold its connection open indefinitely.
//
// The endpoint answers a tool call over text/event-stream, and a chunked
// event-stream has no length: the SDK closes the stream the moment the result
// is written, but the exchange is not over until the CLIENT hangs up. On a
// scale-to-zero runtime that is an instance nobody can retire and a bill
// nobody asked for — production held requests to Cloud Run's 1800s ceiling
// this way. Settling the body before the response leaves gives it a length,
// which is what actually ends it.
//
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/mcp-deadline.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
import { MCP_REQUEST_DEADLINE_MS, withRequestDeadline } from '@/lib/mcp/deadline'

const REQ = () => new Request('https://visvine.com/api/mcp', { method: 'POST' })

/** A response whose body is a stream that ends after `chunks`, like the SDK's. */
function sse(chunks: string[], opts: { hold?: boolean } = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c))
      if (!opts.hold) controller.close()
      // `hold` never closes: the handler that hangs.
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

test('a finished stream comes back as the same bytes, with a length', async () => {
  const frames = ['event: message\n', 'data: {"jsonrpc":"2.0","id":1}\n\n']
  const handler = withRequestDeadline(() => sse(frames))
  const res = await handler(REQ())

  assert.equal(res.status, 200)
  // The framing the client parses is untouched — this is not a protocol change.
  assert.equal(res.headers.get('content-type'), 'text/event-stream')
  assert.equal(await res.text(), frames.join(''))
})

test('a handler that never finishes is answered, not left to the platform', async () => {
  const handler = withRequestDeadline(() => sse(['data: partial\n'], { hold: true }), 40)
  const started = Date.now()
  const res = await handler(REQ())

  assert.equal(res.status, 504)
  assert.ok(Date.now() - started < 2_000, 'the deadline, not the runtime ceiling, ended it')
  const body = (await res.json()) as { error: { code: number; message: string } }
  assert.equal(body.error.code, -32603)
  assert.match(body.error.message, /did not complete/)
})

test('a bodyless response passes straight through', async () => {
  const accepted = new Response(null, { status: 202 })
  const handler = withRequestDeadline(() => accepted)
  assert.equal(await handler(REQ()), accepted)
})

test('status, statusText and headers survive settling', async () => {
  const handler = withRequestDeadline(
    () =>
      new Response('{"error":"nope"}', {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'www-authenticate': 'Bearer realm="visvine"', 'content-type': 'application/json' },
      }),
  )
  const res = await handler(REQ())

  // The 401 challenge is the client's only route to the right scopes: settling
  // must not eat the header that carries it.
  assert.equal(res.status, 401)
  assert.equal(res.headers.get('www-authenticate'), 'Bearer realm="visvine"')
  assert.equal(await res.text(), '{"error":"nope"}')
})

test('the deadline stays well inside the runtime ceiling', () => {
  // Cloud Run's --timeout is 1800s and has to stay there for the agent tick.
  // The point of this wrapper is that MCP never reaches it.
  assert.ok(MCP_REQUEST_DEADLINE_MS < 1_800_000 / 2, 'a deadline near the ceiling is not a deadline')
  // And it must clear the longest bounded thing behind the gateway: a
  // connector run, capped at 120s... which is exactly the deadline, so the
  // wrapper is the backstop for a HUNG handler, not a budget for a slow one.
  assert.ok(MCP_REQUEST_DEADLINE_MS >= 120_000)
})
