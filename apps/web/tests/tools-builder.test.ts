/**
 * The Tool builder's pure half (lib/tools/builder.ts): which actions it may
 * call and how the model sees them, the thread it keeps, and what its system
 * prompt carries. The turn itself is agent chat's, tested in agent-chat.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-builder.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { BUILDER_THREAD, builderSystemPrompt, builderTools } from '@/lib/tools/builder'
import { AGENT_NAME_RE } from '@/lib/agents/config'
import { allActions } from '@/lib/actions/registry'
import { TOOL_AUTHOR_GUIDE } from '@/lib/tools/sdkDocs'
import { renderCatalog } from '@/lib/tools/catalog'
import type { ActionCaller } from '@/lib/actions/types'

const CALLER: ActionCaller = {
  userId: 'user_1',
  name: 'Ada',
  email: 'ada@local.dev',
  scopes: ['context:read', 'tools:author'],
  via: 'api',
  client: 'app',
}

test('the builder may look and author, and never publish, install or write outside a Tool', () => {
  const names = builderTools(CALLER, 'space_1').map((tool) => tool.spec.name)
  assert.deepEqual(names, ['list_tools', 'read_tool', 'create_tool', 'write_tool', 'check_tool', 'list_context', 'read_context'])
  for (const forbidden of ['publish_tool', 'install_tool', 'update_install', 'edit_context', 'add_context', 'run_agent']) {
    assert.equal(names.includes(forbidden), false, forbidden)
  }
})

test("the space is the builder's to fill, never the model's to choose", () => {
  for (const tool of builderTools(CALLER, 'space_1')) {
    const properties = (tool.spec.parameters.properties ?? {}) as Record<string, unknown>
    assert.equal('space_id' in properties, false, `${tool.spec.name} asks the model for a space`)
    assert.equal(tool.spec.parameters.type, 'object')
    assert.equal('$schema' in tool.spec.parameters, false)
  }
  const write = builderTools(CALLER, 'space_1').find((tool) => tool.spec.name === 'write_tool')!
  const props = Object.keys(write.spec.parameters.properties as Record<string, unknown>)
  assert.deepEqual(props.sort(), ['content', 'file', 'name'])
  assert.equal(write.describe?.({ name: 'rsvps', file: 'ui.tsx' }), 'rsvps ui.tsx')
})

test('every tool the builder offers is a real action carrying its own summary', () => {
  const actions = new Map(allActions().map((action) => [action.name, action]))
  for (const tool of builderTools(CALLER, 'space_1')) {
    assert.equal(tool.spec.description, actions.get(tool.spec.name)?.summary)
  }
})

test("the builder's thread can never be an agent's", () => {
  assert.equal(AGENT_NAME_RE.test(BUILDER_THREAD), false)
})

test('the system prompt carries the rules, the intake, the guide and the catalog — and the open tool', () => {
  const bare = builderSystemPrompt({ spaceName: 'Blackbird', tool: null })
  assert.match(bare, /space "Blackbird"/)
  assert.match(bare, /Never publish or install/)
  assert.match(bare, /Should it look like the rest of the app/)
  assert.ok(bare.includes(TOOL_AUTHOR_GUIDE))
  assert.ok(bare.includes(renderCatalog()))
  assert.doesNotMatch(bare, /Workbench is open on/)
  assert.match(builderSystemPrompt({ spaceName: 'Blackbird', tool: 'rsvps' }), /Workbench is open on the tool `rsvps`/)
})
