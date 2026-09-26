// The registry invariant: what the router and the named tools reach, and what it costs.
//
// This matters more than it looks. The scope check happens twice — once in the
// transport, which answers an under-scoped call with an RFC 6750
// `insufficient_scope` challenge (lib/mcp/challenge.ts), and once in
// `runAction` as the gate nothing reaches a body without. Both read
// `scopeForAction`, and it returns null for a name it does not know — so an
// action with no scope would be unreachable rather than open, but unreachable
// for a reason nobody could see from the error. The registry is the one place
// that can be checked, so it is checked here.
//
// It also pins what now carries the boundary between reading someone's notes
// and writing executable code into their space. One server offers every action,
// so that boundary is the SCOPE each action declares and the consent that
// granted it — there is no second endpoint standing in for it any more, and a
// scope that quietly widened would be the whole of the regression.
//
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/actions-registry.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
import { McpServer } from '@modelcontextprotocol/server'
import { DEFAULT_SCOPES, MCP_SCOPES, SCOPE_DESCRIPTIONS } from '@/lib/mcp/scopes'
import { actionByName, allActions, scopeForAction, schemaOf } from '@/lib/actions/registry'
import { registerTools } from '@/lib/mcp/register'
import { TOOL_NAME, actionAnnotations, actionFromToolName, actionToolName } from '@/lib/mcp/gateway'
import { mcpServerInfo } from '@/lib/mcp/config'
import { GUIDES, guideById } from '@/lib/actions/shared/guides'

/** A server that records what was registered on it and runs nothing. */
type Registered = {
  description: string
  inputSchema?: unknown
  annotations?: Record<string, unknown>
  handler: (args: unknown, extra: unknown) => Promise<unknown>
}

function recordingServer(): { server: McpServer; names: string[]; tools: Map<string, Registered> } {
  const names: string[] = []
  const tools = new Map<string, Registered>()
  const server = {
    registerTool(name: string, config: Omit<Registered, 'handler'>, handler: Registered['handler']) {
      names.push(name)
      tools.set(name, { ...config, handler })
    },
  }
  return { server: server as unknown as McpServer, names, tools }
}

test('the server registers the router, then one tool per action', () => {
  // Two doors from one registry: the router for discovery and a named tool per
  // action so a client can permit, deny and log each one by name.
  const { server, names } = recordingServer()
  registerTools(server)
  assert.deepEqual(names, [TOOL_NAME, ...allActions().map((a) => actionToolName(a.name))])
  // Planning a Tool and reading the space it is for are on the same server.
  for (const name of ['plan_tool', 'set_tool_icon', 'list_context', 'list_resources']) assert.ok(names.includes(actionToolName(name)), name)
})

test('the real SDK accepts every tool', () => {
  // The recording server proves what we CALL; this proves the SDK can actually
  // take it — a schema it cannot convert to JSON Schema would pass every other
  // test here and fail at the first `tools/list`.
  const server = new McpServer(mcpServerInfo())
  registerTools(server)
  const registered = (server as unknown as { _registeredTools?: Record<string, unknown> })._registeredTools
  assert.deepEqual(Object.keys(registered ?? {}), [TOOL_NAME, ...allActions().map((a) => actionToolName(a.name))])
})

test('a tool name round-trips to its action, and nothing else does', () => {
  for (const def of allActions()) {
    assert.equal(actionFromToolName(actionToolName(def.name)), def.name)
    assert.equal(actionByName(actionFromToolName(actionToolName(def.name)) ?? ''), def)
  }
  assert.equal(actionFromToolName(TOOL_NAME), null)
  assert.equal(actionFromToolName(`${TOOL_NAME}_`), null)
  assert.equal(actionFromToolName('other'), null)
})

test('a named tool carries the action\'s own schema, scope and hints', () => {
  const { server, tools } = recordingServer()
  registerTools(server)
  for (const def of allActions()) {
    const tool = tools.get(actionToolName(def.name))
    assert.ok(tool, `${def.name} has no tool`)
    // The schema is built from the definition's shape — no copy to drift.
    assert.deepEqual((tool.inputSchema as { shape: unknown }).shape, def.input)
    assert.ok(tool.description.startsWith(def.summary), `${def.name}'s tool must open with its catalogue line`)
    assert.match(tool.description, new RegExp(`\\b${def.scope}\\b`), `${def.name}'s tool must name its scope`)
    assert.deepEqual(tool.annotations, actionAnnotations(def))
  }
})

test('the hints derive from scope unless the definition says otherwise', () => {
  const byName = (name: string) => actionAnnotations(actionByName(name)!)
  // A read scope is read-only, and a read-only tool is never destructive.
  assert.equal(byName('read_context').readOnlyHint, true)
  assert.equal(byName('read_context').destructiveHint, false)
  // A write scope is neither read-only nor safe to retry blind.
  assert.equal(byName('edit_context').readOnlyHint, false)
  assert.equal(byName('edit_context').destructiveHint, true)
  // Reaching outside the platform is the open-world hint.
  assert.equal(byName('run_connector').openWorldHint, true)
  assert.equal(byName('edit_context').openWorldHint, false)
  // Read-only on a write scope is only ever an explicit claim by the definition
  // (`preview_tool` reads the working copy under the authoring scope).
  for (const a of allActions()) {
    if (actionAnnotations(a).readOnlyHint && a.scope !== 'context:read') {
      assert.equal(a.annotations?.readOnlyHint, true, `${a.name} is read-only on ${a.scope} without saying so`)
    }
  }
})

test('a named tool runs through runAction, so the scope gate holds there too', async () => {
  const { server, tools } = recordingServer()
  registerTools(server)
  const tool = tools.get(actionToolName('edit_context'))!
  const extra = { http: { authInfo: { token: 't', clientId: 'c', scopes: ['context:read'], extra: { userId: 'u1', name: 'U', email: 'u@x' } } } }
  const out = (await tool.handler({ space_id: 's', path: 'a.md', content: '' }, extra)) as {
    isError?: boolean
    content: { text: string }[]
  }
  assert.equal(out.isError, true)
  assert.match(out.content[0].text, /context:write/)
})

test("the router's description teaches the protocol and nothing perishable", () => {
  // A client caches this for the life of a connection, so it must not carry the
  // catalogue, the recipes or any per-space fact — all of which come from the
  // notes, on demand, and change without a deploy.
  const { server, tools } = recordingServer()
  registerTools(server)
  const description = tools.get(TOOL_NAME)?.description ?? ''

  assert.ok(description.length > 400, 'the only text a client reads before calling must earn its place')
  assert.match(description, /request/, 'it must say to pass the ask verbatim')
  assert.match(description, /`action`/, 'it must name the discovery step')
  assert.match(description, /`input`/, 'it must say what runs something')
  // The misreading this whole surface invites, corrected where it will be read.
  assert.match(description, /notes at\s+deterministic paths|note/i)
  // Naming one action as an example is worth the words; naming several is a
  // catalogue, and the catalogue belongs in that Context where it can change.
  const named = allActions().filter((a) => description.includes(a.name)).map((a) => a.name)
  assert.ok(named.length <= 1, `the description lists ${named.join(', ')} — that is a catalogue`)
})

test('every action has a scope in the catalogue, and reads outnumber writes', () => {
  const actions = allActions()
  assert.ok(actions.length >= 30, 'the surface should not have quietly shrunk')

  for (const def of actions) {
    assert.ok(MCP_SCOPES.includes(def.scope), `${def.name} wants ${def.scope}, which is not in the catalogue`)
    assert.equal(scopeForAction(def.name), def.scope, `${def.name}'s scope must come from one place`)
    assert.ok(def.summary.length > 20, `${def.name} has no catalogue line worth reading`)
    assert.ok(def.description.length > 120, `${def.name}'s guidance is too thin to act on`)
  }

  // Every kind is created through an action (the apps create nothing), so the
  // surface carries a write per kind — but reading is still a large share of it.
  const reads = actions.filter((a) => a.scope === 'context:read').length
  assert.ok(reads > actions.length / 4, 'a context surface that mostly writes is the wrong shape')

  // A name nothing answers must resolve to nothing, not to a default.
  assert.equal(scopeForAction('no_such_action'), null)
  assert.equal(actionByName('no_such_action'), null)
})

test('the load-bearing scope splits hold across both doors', () => {
  // Reading a Tool is reading notes; the SDK is a static document.
  assert.equal(scopeForAction('list_tools'), 'context:read')
  assert.equal(scopeForAction('read_tool'), 'context:read')
  assert.equal(scopeForAction('get_tool_sdk'), 'context:read')

  // Authoring writes executable code into a space, so it is deliberately NOT
  // context:write: a token granted to tidy notes must not be able to add a
  // running app to the sidebar.
  for (const name of ['create_tool', 'write_tool', 'check_tool', 'preview_tool', 'publish_tool']) {
    assert.equal(scopeForAction(name), 'tools:author', `${name} should be tools:author`)
  }

  // Installing runs code nobody in the space wrote — its own scope.
  assert.equal(scopeForAction('install_tool'), 'tools:install')

  // Storing a credential is not "using a connector": a token granted to CALL
  // Stripe must not be able to REPLACE the Stripe key.
  assert.equal(scopeForAction('run_connector'), 'connectors:use')
  assert.equal(scopeForAction('set_connector_secret'), 'secrets:write')
  assert.notEqual(scopeForAction('set_connector_secret'), scopeForAction('run_connector'))

  // Listing rides the read scope — discovery is not the secret, execution is.
  assert.equal(scopeForAction('list_connectors'), 'context:read')
  assert.equal(scopeForAction('list_agents'), 'context:read')
  assert.equal(scopeForAction('run_agent'), 'agents:run')

  // The clean pass analyses read-only but can apply and trash, so it carries
  // the write scope for the whole action.
  assert.equal(scopeForAction('clean_context'), 'context:write')
  assert.equal(scopeForAction('edit_context'), 'context:write')
  assert.equal(scopeForAction('read_context'), 'context:read')

  // Starting a space writes — never a read-only default token — and a record
  // of an organisation is a different action from a tenant.
  assert.equal(scopeForAction('create_space'), 'context:write')
  assert.notEqual(actionByName('create_space'), actionByName('add_context'))
  assert.ok('parent_id' in actionByName('create_space')!.input, 'a sub-space is create_space with a parent')

  // No app screen creates anything, so every kind has an action. Each writes.
  for (const name of ['create_channel', 'create_section', 'add_type', 'create_event', 'upload_file', 'request_upload', 'set_image']) {
    assert.equal(scopeForAction(name), 'context:write', name)
  }
  // An event is made by create_event alone, with its defaults.
  const addTypes = actionByName('add_context')!.input.type as unknown as { options: string[] }
  assert.ok(!addTypes.options.includes('event'), 'add_context never makes an event')

  // A chat attachment reaches upload_file as ChatGPT's file param.
  assert.deepEqual(actionByName('upload_file')!.mcpMeta, { 'openai/fileParams': ['file'] })
})

test('one catalogue carries every action, authoring included', () => {
  const names = allActions().map((a) => a.name)
  for (const name of [
    'list_spaces',
    'list_context',
    'search_context',
    'edit_context',
    'list_tools',
    'install_tool',
    'get_tool_sdk',
    'create_tool',
    'write_tool',
    'check_tool',
    'preview_tool',
    'publish_tool',
    'read_tool',
  ]) {
    assert.ok(names.includes(name), `${name} is reachable from nowhere`)
  }
})

test('reading context can never author, whatever the connection asked for', () => {
  // With one server this is the entire boundary, so it is asserted directly
  // rather than inferred from which endpoint an action sits on. A read-only
  // grant — what a client that requests nothing gets — must reach no action
  // that writes anything.
  const readOnly = new Set(DEFAULT_SCOPES as readonly string[])
  const reachable = allActions().filter((a) => readOnly.has(a.scope))
  for (const def of reachable) {
    assert.equal(def.scope, 'context:read', `${def.name} is reachable on the default grant but writes`)
    assert.notEqual(def.name, 'edit_context')
  }
  for (const name of ['create_tool', 'write_tool', 'publish_tool', 'install_tool', 'edit_context', 'run_connector', 'set_connector_secret', 'run_agent']) {
    const def = actionByName(name)
    assert.ok(def, `${name} does not exist`)
    assert.ok(!readOnly.has(def.scope), `${name} is reachable on a read-only grant`)
  }
})

// The reads that cover every space the caller can act in when no space is
// named (lib/actions/searchEverywhere.ts). Each is read-only and stamps every
// row with the space it came from; a write is never on this list, because a
// write with no tenant is how a note lands where nobody intended.
const READS_ACROSS_SPACES = ['search_context', 'list_events', 'list_agents', 'list_connectors', 'list_resources']

test('every action validates its own input', () => {
  // The registry is the perimeter, and a schema that accepts anything is a hole
  // in it. Every action that names a space must require one, except the reads
  // above — and those must be read-only, so an optional tenant can only ever
  // widen what is READ, under the caller's own standing in each space.
  for (const def of allActions()) {
    const schema = schemaOf(def)
    assert.ok(schema, `${def.name} has no schema`)
    if (!('space_id' in def.input)) continue
    if (READS_ACROSS_SPACES.includes(def.name)) {
      assert.equal(def.scope, 'context:read', `${def.name} reads across spaces but is not read-only`)
      assert.equal(def.annotations?.readOnlyHint, true, `${def.name} reads across spaces without readOnlyHint`)
      // The other arguments still apply (search_context needs its query), so
      // the probe supplies them and leaves only space_id out.
      const rest = def.name === 'search_context' ? { query: 'x' } : {}
      assert.equal(schema.safeParse(rest).success, true, `${def.name} should accept a call with no space`)
      continue
    }
    assert.equal(
      schema.safeParse({}).success,
      false,
      `${def.name} takes a space_id but accepts a call without one`,
    )
  }
})

test('every catalogue scope has consent copy', () => {
  // The consent page renders it unconditionally.
  for (const scope of MCP_SCOPES) {
    assert.ok(SCOPE_DESCRIPTIONS[scope]?.length > 20, `${scope} has no readable consent description`)
  }
})

test('the writing contract is one guide, and the write actions point at it', () => {
  // Folders, mentions and lifecycle were pasted into four descriptions; now
  // they are one guide each of those actions names, so a change is one edit.
  const guide = guideById('writing_notes')!
  assert.ok(guide, 'the writing_notes guide exists')
  assert.match(guide.body, /## Folders/)
  assert.match(guide.body, /## Mentions/)
  assert.match(guide.body, /## Lifecycle/)
  assert.match(guide.body, /leading slash/i)
  assert.match(guide.body, /index:children/)
  assert.match(guide.body, /supersedes:/)

  for (const name of ['add_context', 'edit_context', 'append_context', 'clean_context']) {
    const def = actionByName(name)!
    assert.deepEqual(def.guides, ['writing_notes'], `${name} must name the guide`)
    // The description keeps the one line that matters most and points at the rest.
    assert.match(def.description, /ROOT-RELATIVE|leading slash/i, `${name} must still say the slash`)
    assert.match(def.description, /writing_notes/, `${name} must point at the guide`)
    assert.ok(!def.description.includes('index:children'), `${name} must not inline the folder contract`)
    assert.ok(def.description.length < 2_600, `${name}'s description is ${def.description.length} chars`)
  }
  // A guide id is never an action: it cannot be run, only read.
  assert.equal(actionByName('writing_notes'), null)
  assert.equal(scopeForAction('writing_notes'), null)
  // Every guide an action names exists.
  for (const def of allActions()) for (const id of def.guides ?? []) assert.ok(guideById(id), `${def.name} names guide ${id}`)
  assert.ok(GUIDES.every((g) => /^[a-z_]+$/.test(g.id)))
})
