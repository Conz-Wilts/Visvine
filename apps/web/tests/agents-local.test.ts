// A member's own plan as a model (lib/agents/local.ts): how `local/<runtime>`
// parses, what the server refuses, and what the kill switch reads.
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/agents-local.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { localAgentPreamble, localModelRef, localRuntimeOf, localRuntimeRefusal, localRuntimesEnabled, LOCAL_PROVIDER } from '@/lib/agents/local'
import { parseModelRef } from '@/lib/agents/registry'
import { parseAgentBrief } from '@/lib/agents/config'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'

test('local/<runtime> parses to the local provider and nothing else does', () => {
  const claude = parseModelRef('local/claude')
  assert.ok(claude.ok)
  assert.equal(claude.ref.provider.id, 'local')
  assert.equal(claude.ref.modelId, 'claude')
  assert.equal(claude.ref.pricing, null)
  assert.ok(parseModelRef('local/codex').ok)
  const bad = parseModelRef('local/gemini')
  assert.ok(!bad.ok)
  assert.match(bad.error, /local\/claude/)
  assert.equal(localRuntimeOf('local/claude'), 'claude')
  assert.equal(localRuntimeOf('LOCAL/Codex'), 'codex')
  assert.equal(localRuntimeOf('anthropic/claude-sonnet-5'), null)
  assert.equal(localRuntimeOf(null), null)
  assert.equal(localModelRef('codex'), 'local/codex')
  // The key nothing stores: every "is it stored" check answers no.
  assert.equal(LOCAL_PROVIDER.keySecret, 'MODEL_KEY_LOCAL')
})

test('a brief may pin a local runtime, and it carries through as its modelRef', () => {
  const note = ['---', 'type: agent', 'title: Digest', 'model: local/claude', '---', 'Do the thing.'].join('\n')
  const parsed = parseAgentBrief(parseFrontmatter(note), 'Do the thing.')
  assert.ok(parsed.ok)
  assert.equal(parsed.brief.model, 'local/claude')
  assert.equal(parsed.brief.modelRef?.provider.id, 'local')
})

test('the refusal names the plan and says where to run it', () => {
  assert.match(localRuntimeRefusal('claude'), /your claude plan/i)
  assert.match(localRuntimeRefusal('claude'), /desktop app/)
  assert.match(localRuntimeRefusal('codex'), /cannot be scheduled/)
})

test('the kill switch reads LOCAL_RUNTIMES_OFF', () => {
  assert.deepEqual(localRuntimesEnabled({}), { claude: true, codex: true })
  assert.deepEqual(localRuntimesEnabled({ LOCAL_RUNTIMES_OFF: 'claude' }), { claude: false, codex: true })
  assert.deepEqual(localRuntimesEnabled({ LOCAL_RUNTIMES_OFF: ' Codex , claude ' }), { claude: false, codex: false })
  assert.deepEqual(localRuntimesEnabled({ LOCAL_RUNTIMES_OFF: 'all' }), { claude: false, codex: false })
})

test('the local preamble names the agent, its memory, and whether the visvine tool is there', () => {
  const withTool = localAgentPreamble('digest', { hasVisvineTool: true })
  assert.match(withTool, /named "digest"/)
  assert.match(withTool, /agents\/digest\/memory\.md/)
  assert.match(withTool, /visvine tool/)
  assert.match(withTool, /# Brief$/)
  const without = localAgentPreamble('digest', { hasVisvineTool: false })
  assert.match(without, /not reachable from this run/)
  assert.doesNotMatch(without, /memory\.md/)
})
