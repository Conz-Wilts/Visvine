/**
 * The narrated-tool-call detector (lib/notes/shared/narratedToolCall.ts) and
 * what the shared loop does with it.
 *
 * The bug it exists for: a model answers with a plan and a block of
 * `default_api.fetch_url(...)` instead of calling anything. The loop saw a
 * reply with no tool calls, read it as the final answer, and the run was
 * recorded as a SUCCESS having fetched nothing and written nothing.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/narrated-tool-call.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { announcedNextStep, narratedToolCall, NEXT_STEP_NUDGE } from '@/lib/notes/shared/narratedToolCall'
import { MAX_REVIEWS, runToolLoop, type ChatFn, type ToolHandler } from '@/lib/notes/toolLoop'
import type { ChatWithToolsResult } from '@/lib/notes/ai'

const TOOLS = ['fetch_url', 'write_context', 'read_context']

test('a namespaced call written as text is caught, wherever it sits', () => {
  assert.equal(narratedToolCall('I will now run default_api.fetch_url(url="https://x")', TOOLS), 'fetch_url')
  assert.equal(narratedToolCall('```python\nprint(default_api.fetch_url(url="a"))\n```', TOOLS), 'fetch_url')
  assert.equal(narratedToolCall('functions.write_context(path="a.md")', TOOLS), 'write_context')
})

test('a bare call inside a fence is caught; the same words in prose are not', () => {
  assert.equal(narratedToolCall('Step 1:\n```tool_code\nfetch_url(url="https://x")\n```', TOOLS), 'fetch_url')
  assert.equal(narratedToolCall('I used fetch_url (twice) and it worked.', TOOLS), null)
  assert.equal(narratedToolCall('The story explains what fetch_url(ish) APIs are for.', TOOLS), null)
})

test('the JSON envelope counts only beside an arguments key, or inside a fence', () => {
  assert.equal(narratedToolCall('{"name": "fetch_url", "arguments": {"url": "x"}}', TOOLS), 'fetch_url')
  assert.equal(narratedToolCall('```json\n{"name": "fetch_url"}\n```', TOOLS), 'fetch_url')
  assert.equal(narratedToolCall('The field "name": "fetch_url" appears in the log.', TOOLS), null)
})

test('an XML-shaped call emitted as text is caught', () => {
  assert.equal(narratedToolCall('<invoke name="read_context">', TOOLS), 'read_context')
})

test('a tool the run does not have is prose, not a narrated call', () => {
  assert.equal(narratedToolCall('default_api.send_email(to="a")', TOOLS), null)
  assert.equal(narratedToolCall('anything at all', []), null)
})

test('an ordinary final answer is left alone', () => {
  assert.equal(narratedToolCall('I wrote the digest to agents/hn/2026-09-18.md — four stories.', TOOLS), null)
  assert.equal(narratedToolCall(null, TOOLS), null)
  assert.equal(narratedToolCall('', TOOLS), null)
})

const fetchUrl: ToolHandler = {
  spec: { name: 'fetch_url', description: 'fetch', parameters: { type: 'object', properties: {} } },
  run: async () => 'page body',
}

function scripted(replies: Partial<ChatWithToolsResult>[]): ChatFn & { seen: string[] } {
  let i = 0
  const fn = Object.assign(
    async (messages: { role: string; content?: string | null }[]): Promise<ChatWithToolsResult> => {
      fn.seen = messages.filter((m) => m.role === 'user').map((m) => m.content ?? '')
      const r = replies[i++] ?? { content: 'done', toolCalls: [] }
      return { content: r.content ?? null, toolCalls: r.toolCalls ?? [], usage: r.usage ?? null }
    },
    { seen: [] as string[] },
  )
  return fn
}

const NARRATION = 'Plan:\n1. Fetch the front page.\n```python\ndefault_api.fetch_url(url="https://hn")\n```'

test('a narrated call is corrected, not accepted as the answer', async () => {
  const chatFn = scripted([
    { content: NARRATION },
    { content: null, toolCalls: [{ id: '1', name: 'fetch_url', arguments: '{}' }] },
    { content: 'Wrote the digest.' },
  ])
  const result = await runToolLoop({ messages: [], tools: [fetchUrl], maxTurns: 8, chatFn })
  assert.equal(result.reason, 'finished')
  assert.equal(result.finalText, 'Wrote the digest.')
  assert.ok(chatFn.seen.some((m) => m.includes('NOTHING RAN')), 'the model was told its call did not run')
})

test('a model that keeps narrating FAILS the loop rather than passing off a plan as work', async () => {
  const chatFn = scripted([{ content: NARRATION }, { content: NARRATION }, { content: NARRATION }])
  const result = await runToolLoop({ messages: [], tools: [fetchUrl], maxTurns: 8, chatFn })
  assert.equal(result.reason, 'narrated')
  assert.equal(result.narratedTool, 'fetch_url')
})

test('a reply that stops on its next step is told once, then believed', async () => {
  assert.ok(announcedNextStep("I've fetched both lists. Now I'll combine these and select the top 10 by points."))
  assert.ok(announcedNextStep('Let me write the note.'))
  assert.ok(announcedNextStep('I will use decide on them. Finally, I will write the top 10 to the note.'))
  assert.ok(announcedNextStep('The agent collected the stories. Next, it will combine the lists and pick the top 10.'))
  assert.equal(announcedNextStep('Listed 10 stories in agents/hn/top-ai.md.'), false)
  assert.equal(announcedNextStep("Nothing changed today. I'll check again next run."), false)
  assert.equal(announcedNextStep('I will now explain: the digest is written.'), false, 'only the last sentence is read')
  assert.equal(announcedNextStep(null), false)

  const once = scripted([{ content: 'Fetched. Now I will write it.' }, { content: 'Wrote it.' }])
  const r = await runToolLoop({ messages: [{ role: 'user', content: 'go' }], tools: [fetchUrl], maxTurns: 5, chatFn: once })
  assert.equal(r.reason, 'finished')
  assert.equal(r.finalText, 'Wrote it.')
  assert.ok(once.seen.includes(NEXT_STEP_NUDGE))

  // An empty reply is the same pause.
  const silent = scripted([{ content: '' }, { content: 'Done.' }])
  const r1 = await runToolLoop({ messages: [{ role: 'user', content: 'go' }], tools: [fetchUrl], maxTurns: 5, chatFn: silent })
  assert.equal(r1.finalText, 'Done.')

  // Promising again is its answer: one nudge, never a loop, never a failure.
  const twice = scripted([{ content: "Now I'll do it." }, { content: "Now I'll do it." }])
  const r2 = await runToolLoop({ messages: [{ role: 'user', content: 'go' }], tools: [fetchUrl], maxTurns: 5, chatFn: twice })
  assert.equal(r2.reason, 'finished')
  assert.equal(r2.turns, 2)
})

test('a review hands a short answer back, a bounded number of times', async () => {
  const chatFn = scripted([
    { content: 'Fetched the page.' },
    { content: 'Wrote the digest.' },
  ])
  const asked: (string | null)[] = []
  const r = await runToolLoop({
    messages: [{ role: 'user', content: 'go' }],
    tools: [fetchUrl],
    maxTurns: 6,
    chatFn,
    review: async (text) => {
      asked.push(text)
      return text === 'Fetched the page.' ? 'Carry on and write it.' : null
    },
  })
  assert.equal(r.reason, 'finished')
  assert.equal(r.finalText, 'Wrote the digest.')
  assert.deepEqual(asked, ['Fetched the page.', 'Wrote the digest.'])
  assert.ok(chatFn.seen.includes('Carry on and write it.'))

  // A reviewer that is never satisfied cannot hold the run open.
  const stubborn = scripted([{ content: 'a' }, { content: 'b' }, { content: 'c' }, { content: 'd' }])
  const r2 = await runToolLoop({ messages: [{ role: 'user', content: 'go' }], tools: [fetchUrl], maxTurns: 9, chatFn: stubborn, review: async () => 'again' })
  assert.equal(r2.reason, 'finished')
  assert.equal(r2.turns, MAX_REVIEWS + 1)

  // A review that throws accepts the answer.
  const r3 = await runToolLoop({ messages: [{ role: 'user', content: 'go' }], tools: [fetchUrl], maxTurns: 3, chatFn: scripted([{ content: 'x' }]), review: async () => { throw new Error('judge down') } })
  assert.equal(r3.finalText, 'x')
})
