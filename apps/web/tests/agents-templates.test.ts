/**
 * Starter briefs (lib/agents/templates.ts) and the settings editor
 * (lib/agents/briefEdit.ts): every template must be a valid brief once written
 * by newAgentNote, and editing settings must leave the prose and every
 * unrelated frontmatter key alone.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/agents-templates.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { AGENT_TEMPLATES, agentTemplateById } from '@/lib/agents/templates'
import { readBriefSettings, updateBriefSettings } from '@/lib/agents/briefEdit'
import { newAgentNote, parseAgentBrief, AGENT_TOOL_OPTIONS, AGENT_TOOL_EXTRAS } from '@/lib/agents/config'
import { parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'

const parse = (content: string) => parseAgentBrief(parseFrontmatter(content), splitFrontmatter(content).body)

test('every template writes a brief the parser accepts', () => {
  const ids = new Set<string>()
  for (const t of AGENT_TEMPLATES) {
    assert.ok(!ids.has(t.id), `duplicate template id ${t.id}`)
    ids.add(t.id)
    const note = newAgentNote({ name: t.id, title: t.title, description: t.description, tools: t.tools, body: t.body })
    const parsed = parse(note)
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

test('updateBriefSettings rewrites settings and keeps the prose and hand-written keys', () => {
  const original = [
    '---',
    'type: agent',
    'title: "Weekly digest"',
    'model: gemini/gemma-4-31b-it',
    'connectors: [hubspot]',
    'agents: [crm-sync]',
    'owner: ops',
    'max_turns: 16',
    '---',
    'Read the week. Write the digest.',
    '',
    '## Notes',
    '- keep it short',
    '',
  ].join('\n')

  const before = readBriefSettings(original)
  assert.deepEqual(before, { model: 'gemini/gemma-4-31b-it', description: '', connectors: ['hubspot'], tools: [], dryRun: false, maxTurns: 16, tags: [] })

  const next = updateBriefSettings(original, {
    model: 'openai/gpt-4.1-mini',
    description: 'Summarises the week',
    connectors: ['hubspot', 'slack'],
    tools: ['web', 'messages'],
    dryRun: true,
    maxTurns: 8,
    tags: ['Investments', 'weekly'],
  })
  const parsed = parse(next)
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  if (parsed.ok) {
    assert.equal(parsed.brief.model, 'openai/gpt-4.1-mini')
    assert.equal(parsed.brief.description, 'Summarises the week')
    assert.deepEqual(parsed.brief.connectors, ['hubspot', 'slack'])
    assert.deepEqual(parsed.brief.tools, ['web', 'messages'])
    assert.equal(parsed.brief.dryRun, true)
    assert.equal(parsed.brief.maxTurns, 8)
    assert.deepEqual(parsed.brief.agents, ['crm-sync'])
    assert.deepEqual(parsed.brief.tags, ['Investments', 'weekly'])
    assert.equal(parsed.brief.title, 'Weekly digest')
    assert.equal(parsed.brief.body, 'Read the week. Write the digest.\n\n## Notes\n- keep it short')
  }
  assert.equal(parseFrontmatter(next).owner, 'ops')

  // Defaults are dropped rather than written.
  const cleared = updateBriefSettings(next, { tools: [], dryRun: false, description: '', maxTurns: null })
  const fm = parseFrontmatter(cleared)
  assert.equal(fm.tools, undefined)
  assert.equal(fm.dry_run, undefined)
  assert.equal(fm.description, undefined)
  assert.equal(fm.max_turns, undefined)
  assert.ok(parse(cleared).ok)
})

test('updateBriefSettings on a note with no frontmatter still yields a brief', () => {
  const next = updateBriefSettings('Just prose.\n', { model: 'gemini/gemini-2.5-flash' })
  const parsed = parse(next)
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  if (parsed.ok) assert.equal(parsed.brief.body, 'Just prose.')
})
