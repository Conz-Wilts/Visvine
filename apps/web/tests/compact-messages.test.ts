/**
 * compactOlderResults (lib/notes/shared/compactMessages.ts): only old, long
 * tool results are shortened; recent ones and everything else go out whole.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/compact-messages.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { AgentMessage } from '@/lib/notes/ai'
import { compactOlderResults } from '@/lib/notes/shared/compactMessages'

const call = (id: string): AgentMessage => ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'fetch_url', arguments: '{}' } }] })
const result = (id: string, chars: number): AgentMessage => ({ role: 'tool', tool_call_id: id, content: 'x'.repeat(chars) })

test('an old long result is trimmed; recent and short ones are not', () => {
  const messages: AgentMessage[] = [{ role: 'system', content: 's'.repeat(20_000) }, { role: 'user', content: 'go' }]
  messages.push(call('a'), result('a', 30_000), call('b'), result('b', 500))
  for (const id of ['c', 'd', 'e', 'f', 'g', 'h']) messages.push(call(id), result(id, 30_000))
  const out = compactOlderResults(messages, { keepTurns: 3, minChars: 8_000, keepHead: 1_000 })
  const len = (id: string) => (out.find((m) => m.role === 'tool' && m.tool_call_id === id) as { content: string }).content.length
  assert.ok(len('a') < 1_200, 'turn 1 of 8 is old and long')
  assert.equal(len('b'), 500, 'short results stay')
  assert.ok(len('e') < 1_200)
  for (const id of ['f', 'g', 'h']) assert.equal(len(id), 30_000, `${id} is recent`)
  assert.equal((out[0] as { content: string }).content.length, 20_000, 'the system prompt is never trimmed')
  assert.equal((messages[3] as { content: string }).content.length, 30_000, 'the input is not mutated')
})

test('a short run is sent whole', () => {
  const messages: AgentMessage[] = [{ role: 'user', content: 'go' }, call('a'), result('a', 30_000), call('b'), result('b', 30_000)]
  assert.deepEqual(compactOlderResults(messages), messages)
})
