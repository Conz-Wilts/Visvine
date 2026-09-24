/**
 * Starter briefs (lib/agents/templates.ts) and the Group editor
 * (lib/agents/briefEdit.ts): every template must be a valid agent once its
 * note is written by newAgentNote and its tools set on a fresh record, and
 * editing tags must leave the prose and every other key alone.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/agents-templates.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { AGENT_TEMPLATES, agentTemplateById } from '@/lib/agents/templates'
import { briefTags, withBriefTags } from '@/lib/agents/briefEdit'
import { applyConfigPatch, defaultAgentConfig, effectiveFrontmatter } from '@/lib/agents/shared/agentConfig'
import { newAgentNote, parseAgentBrief, AGENT_TOOL_OPTIONS, AGENT_TOOL_EXTRAS } from '@/lib/agents/config'
import { parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'

const parse = (content: string) => parseAgentBrief(parseFrontmatter(content), splitFrontmatter(content).body)

test('every template writes a brief the parser accepts', () => {
  const ids = new Set<string>()
  for (const t of AGENT_TEMPLATES) {
    assert.ok(!ids.has(t.id), `duplicate template id ${t.id}`)
    ids.add(t.id)
    const note = newAgentNote({ name: t.id, title: t.title, description: t.description, body: t.body })
    const config = applyConfigPatch(defaultAgentConfig(), { tools: t.tools })
    assert.ok(config.ok, `${t.id}: ${config.ok ? '' : config.error}`)
    if (!config.ok) continue
    const parsed = parseAgentBrief(effectiveFrontmatter(parseFrontmatter(note), config.config), splitFrontmatter(note).body)
    assert.ok(parsed.ok, `${t.id}: ${parsed.ok ? '' : parsed.error}`)
    if (parsed.ok) {
      assert.equal(parsed.brief.title, t.title)
      assert.equal(parsed.brief.description, t.description)
      assert.deepEqual(parsed.brief.tools, t.tools)
      assert.equal(parsed.brief.body, t.body.trim())
    }
  }
  assert.equal(agentTemplateById('weekly-digest')?.title, 'Weekly digest')
  assert.equal(agentTemplateById('nope'), null)
})

test('every tool option is a real extra; machine, sandbox and messages are unlisted', () => {
  const options = AGENT_TOOL_OPTIONS.map((o) => o.id).sort()
  for (const id of options) assert.ok((AGENT_TOOL_EXTRAS as readonly string[]).includes(id), id)
  // None is a checkbox: an agent gets a computer whenever the space has one
  // (which is what `sandbox` once promised), and `messages` grants nothing at
  // all. The names stay valid so an older brief still parses.
  assert.deepEqual([...AGENT_TOOL_EXTRAS].filter((id) => !options.includes(id)), ['sandbox', 'messages', 'machine'])
})

test('withBriefTags rewrites the group and keeps the prose and every other key', () => {
  const original = ['---', 'type: agent', 'title: "Weekly digest"', 'owner: ops', '---', 'Read the week.', ''].join('\n')
  assert.deepEqual(briefTags(original), [])
  const next = withBriefTags(original, ['Investments', ' weekly ', 'Investments'])
  assert.deepEqual(briefTags(next), ['Investments', 'weekly'])
  assert.equal(parseFrontmatter(next).owner, 'ops')
  const parsed = parse(next)
  assert.ok(parsed.ok && parsed.brief.body === 'Read the week.' && parsed.brief.title === 'Weekly digest')
  assert.equal(parseFrontmatter(withBriefTags(next, [])).tags, undefined, 'empty drops the key')
})
