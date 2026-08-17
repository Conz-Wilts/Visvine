/**
 * The shared tool-calling loop (lib/notes/toolLoop.ts) against a scripted
 * model — no API key, no network. This is the mechanics every server-side
 * agent rides on: tool dispatch, bad-args handling, turn caps, aborts, and
 * the caller-supplied stop (budget) hook.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tool-loop.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { runToolLoop, type ChatFn, type ToolHandler, type ToolLoopEvent } from '@/lib/notes/toolLoop'
import type { ChatWithToolsResult } from '@/lib/notes/ai'

const echo: ToolHandler = {
  spec: { name: 'echo', description: 'echo', parameters: { type: 'object', properties: { text: { type: 'string' } } } },
  describe: (args) => String(args.text ?? ''),
  run: async (args) => `echoed:${String(args.text ?? '')}`,
}

const boom: ToolHandler = {
  spec: { name: 'boom', description: 'throws', parameters: { type: 'object', properties: {} } },
  run: async () => {
    throw new Error('kaboom')
  },
}

/** A model that plays back a fixed list of replies, then answers plainly. */
function scripted(replies: Partial<ChatWithToolsResult>[]): ChatFn & { calls: number } {
  let i = 0
  const fn = Object.assign(
    async (): Promise<ChatWithToolsResult> => {
      const r = replies[i++] ?? { content: 'done', toolCalls: [] }
      fn.calls = i
      return { content: r.content ?? null, toolCalls: r.toolCalls ?? [], usage: r.usage ?? null }
    },
    { calls: 0 },
  )
  return fn
}

test('finishes on a plain answer and returns it as finalText', async () => {
  const chatFn = scripted([{ content: 'all good' }])
  const result = await runToolLoop({ messages: [{ role: 'user', content: 'hi' }], tools: [echo], maxTurns: 5, chatFn })
  assert.equal(result.reason, 'finished')
  assert.equal(result.finalText, 'all good')
  assert.equal(result.turns, 1)
})

test('runs tools, feeds results back, and emits events in order', async () => {
  const events: ToolLoopEvent[] = []
  const chatFn = scripted([
    { content: 'let me echo', toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"text":"hey"}' }] },
    { content: 'finished' },
  ])
  const result = await runToolLoop({
    messages: [{ role: 'user', content: 'go' }],
    tools: [echo],
    maxTurns: 5,
    chatFn,
    onEvent: (e) => events.push(e),
  })
  assert.equal(result.reason, 'finished')
  assert.deepEqual(events, [
    { type: 'assistant', text: 'let me echo' },
    { type: 'tool', tool: 'echo', detail: 'hey' },
    { type: 'tool_result', tool: 'echo', text: 'echoed:hey' },
  ])
})

test('bad JSON args, unknown tools and throwing tools all come back as text errors', async () => {
  const events: ToolLoopEvent[] = []
  const chatFn = scripted([
    {
      toolCalls: [
        { id: 'a', name: 'echo', arguments: 'not json' },
        { id: 'b', name: 'nope', arguments: '{}' },
        { id: 'c', name: 'boom', arguments: '{}' },
      ],
    },
    { content: 'ok' },
  ])
  const result = await runToolLoop({
    messages: [{ role: 'user', content: 'go' }],
    tools: [echo, boom],
    maxTurns: 5,
    chatFn,
    onEvent: (e) => events.push(e),
  })
  assert.equal(result.reason, 'finished')
  const results = events.filter((e) => e.type === 'tool_result').map((e) => (e as { text: string }).text)
  assert.deepEqual(results, ['error: unknown tool nope', 'error: kaboom'])
})

test('stops at the turn cap', async () => {
  const chatFn = scripted(
    Array.from({ length: 10 }, () => ({ toolCalls: [{ id: 'x', name: 'echo', arguments: '{"text":"again"}' }] })),
  )
  const result = await runToolLoop({ messages: [{ role: 'user', content: 'go' }], tools: [echo], maxTurns: 3, chatFn })
  assert.equal(result.reason, 'max_turns')
  assert.equal(result.turns, 3)
  assert.equal(chatFn.calls, 3)
})

test('accumulates usage and honours beforeTurn stops', async () => {
  const chatFn = scripted([
    { toolCalls: [{ id: 'x', name: 'echo', arguments: '{}' }], usage: { promptTokens: 100, completionTokens: 10 } },
    { toolCalls: [{ id: 'y', name: 'echo', arguments: '{}' }], usage: { promptTokens: 200, completionTokens: 20 } },
    { content: 'never reached' },
  ])
  const result = await runToolLoop({
    messages: [{ role: 'user', content: 'go' }],
    tools: [echo],
    maxTurns: 10,
    chatFn,
    beforeTurn: ({ usage }) => (usage.promptTokens >= 300 ? 'budget' : null),
  })
  assert.equal(result.reason, 'stopped')
  assert.equal(result.stopReason, 'budget')
  assert.deepEqual(result.usage, { promptTokens: 300, completionTokens: 30 })
  assert.equal(chatFn.calls, 2)
})

test('a model error ends the loop with reason=error', async () => {
  const chatFn: ChatFn = async () => {
    throw new Error('401 nope')
  }
  const result = await runToolLoop({ messages: [{ role: 'user', content: 'go' }], tools: [echo], maxTurns: 3, chatFn })
  assert.equal(result.reason, 'error')
  assert.equal(result.error?.message, '401 nope')
})

test('an aborted signal ends the loop with reason=aborted', async () => {
  const controller = new AbortController()
  controller.abort()
  const chatFn = scripted([{ content: 'unreachable' }])
  const result = await runToolLoop({
    messages: [{ role: 'user', content: 'go' }],
    tools: [echo],
    maxTurns: 3,
    chatFn,
    signal: controller.signal,
  })
  assert.equal(result.reason, 'aborted')
  assert.equal(chatFn.calls, 0)
})
