// The MCP tool gate: `tools:` in a connector's frontmatter, the three verdicts
// it can hand down, and the round trip back into the note the console writes.
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/connector-tool-policy.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  callableTools,
  groupPermission,
  OPEN_TOOL_POLICY,
  parseToolPolicy,
  refuseTool,
  toolGroup,
  toolPermission,
  toolPolicyFrontmatter,
  withPermissions,
  type ToolPolicy,
} from '@/lib/connectors/toolPolicy'
import { parseConnectorPerimeter } from '@/lib/connectors/config'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'

function policy(raw: unknown): ToolPolicy {
  const parsed = parseToolPolicy(raw)
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  return parsed.policy
}

test('a note with no tools block allows everything', () => {
  const p = policy(undefined)
  assert.deepEqual(p, OPEN_TOOL_POLICY)
  assert.equal(toolPermission(p, 'anything_at_all'), 'allow')
  assert.equal(refuseTool(p, 'anything_at_all', false), null)
})

test('verdict lists override the default, by exact tool name', () => {
  const p = policy({ default: 'allow', ask: ['send_message'], deny: ['delete_workspace'] })
  assert.equal(toolPermission(p, 'search'), 'allow')
  assert.equal(toolPermission(p, 'send_message'), 'ask')
  assert.equal(toolPermission(p, 'delete_workspace'), 'deny')
  // Names are exact: a prefix is not a match.
  assert.equal(toolPermission(p, 'send_message_v2'), 'allow')
})

test('a default of deny mutes everything not listed', () => {
  const p = policy({ default: 'deny', allow: ['search'] })
  assert.equal(refuseTool(p, 'search', false), null)
  assert.match(refuseTool(p, 'send_message', true) ?? '', /set to never/)
})

test('ask is about presence: refused unattended, allowed when someone is here', () => {
  const p = policy({ default: 'allow', ask: ['send_message'] })
  assert.equal(refuseTool(p, 'send_message', true), null)
  const refusal = refuseTool(p, 'send_message', false)
  assert.match(refusal ?? '', /only when someone is here/)
  // deny ignores presence entirely — that is the difference between the two.
  const denied = policy({ default: 'allow', deny: ['drop_table'] })
  assert.ok(refuseTool(denied, 'drop_table', true))
  assert.ok(refuseTool(denied, 'drop_table', false))
})

test('a listing never advertises a tool the gate would refuse right now', () => {
  const p = policy({ default: 'allow', ask: ['send_message'], deny: ['drop_table'] })
  const tools = [{ name: 'search' }, { name: 'send_message' }, { name: 'drop_table' }]
  assert.deepEqual(callableTools(p, tools, false).map((t) => t.name), ['search'])
  assert.deepEqual(callableTools(p, tools, true).map((t) => t.name), ['search', 'send_message'])
})

test('one name under two verdicts is an error, not last-wins', () => {
  const parsed = parseToolPolicy({ default: 'allow', ask: ['x'], deny: ['x'] })
  assert.equal(parsed.ok, false)
  assert.match(parsed.ok ? '' : parsed.error, /both ask and deny/)
})

test('a malformed block is an admin-readable error', () => {
  for (const raw of [['a'], { default: 'maybe' }, { default: 'allow', ask: 'send' }, { default: 'allow', deny: [3] }]) {
    const parsed = parseToolPolicy(raw)
    assert.equal(parsed.ok, false, `expected ${JSON.stringify(raw)} to be refused`)
  }
})

test('the block round-trips through the note, and says nothing when there is nothing to say', () => {
  assert.equal(toolPolicyFrontmatter(OPEN_TOOL_POLICY), null)
  // A rule agreeing with the default is not a rule.
  assert.equal(toolPolicyFrontmatter({ default: 'allow', rules: { search: 'allow' } }), null)

  const p = policy({ default: 'allow', ask: ['b', 'a'], deny: ['z'] })
  const block = toolPolicyFrontmatter(p)
  assert.deepEqual(block, { default: 'allow', ask: ['a', 'b'], deny: ['z'] })
  assert.deepEqual(policy(block), p)
})

test('withPermissions drops rules that fall back to the default', () => {
  const p = policy({ default: 'allow', deny: ['x', 'y'] })
  const next = withPermissions(p, ['x'], 'allow')
  assert.deepEqual(next.rules, { y: 'deny' })
  assert.deepEqual(withPermissions(p, ['x', 'y'], 'ask').rules, { x: 'ask', y: 'ask' })
})

test('a group reports one verdict only when its tools agree', () => {
  const p = policy({ default: 'allow', ask: ['b'] })
  assert.equal(groupPermission(p, [{ name: 'a' }, { name: 'c' }]), 'allow')
  assert.equal(groupPermission(p, [{ name: 'a' }, { name: 'b' }]), null)
  assert.equal(groupPermission(p, []), null)
})

test('a tool is read-only only when the server says so', () => {
  assert.equal(toolGroup({ readOnlyHint: true }), 'read')
  assert.equal(toolGroup({ readOnlyHint: false }), 'writes')
  // An unannotated tool lands with the writes — the safe way to be wrong is to
  // put the decision in front of the person.
  assert.equal(toolGroup(null), 'writes')
  assert.equal(toolGroup(undefined), 'writes')
  assert.equal(toolGroup({}), 'writes')
})

test('the perimeter parses `mcp:` and `tools:` off a real connector note', () => {
  const note = [
    '---',
    'type: connector',
    'recipe: notion',
    'hosts:',
    '  - mcp.notion.com',
    'mcp:',
    '  url: https://mcp.notion.com/mcp',
    'tools:',
    '  default: allow',
    '  ask:',
    '    - create_page',
    '  deny:',
    '    - delete_page',
    '---',
    '',
    'body',
  ].join('\n')
  const parsed = parseConnectorPerimeter(parseFrontmatter(note))
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  assert.equal(parsed.perimeter.mcp?.url, 'https://mcp.notion.com/mcp')
  assert.equal(toolPermission(parsed.perimeter.tools, 'create_page'), 'ask')
  assert.equal(toolPermission(parsed.perimeter.tools, 'delete_page'), 'deny')
  assert.equal(toolPermission(parsed.perimeter.tools, 'search'), 'allow')
})

test('a bad mcp url is refused at parse, not at call time', () => {
  const bad = parseConnectorPerimeter(parseFrontmatter(
    ['---', 'type: connector', 'hosts: []', 'mcp:', '  url: not-a-url', '---', ''].join('\n'),
  ))
  assert.equal(bad.ok, false)

  const scheme = parseConnectorPerimeter(parseFrontmatter(
    ['---', 'type: connector', 'hosts: []', 'mcp:', '  url: ftp://example.com/mcp', '---', ''].join('\n'),
  ))
  assert.equal(scheme.ok, false)
})
