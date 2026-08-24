// The registry invariant: what the one tool can reach, and what it costs.
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
import { TOOL_NAME } from '@/lib/mcp/gateway'
import { mcpServerInfo } from '@/lib/mcp/config'

/** A server that records what was registered on it and runs nothing. */
function recordingServer(): { server: McpServer; names: string[]; descriptions: Map<string, string> } {
  const names: string[] = []
  const descriptions = new Map<string, string>()
  const server = {
    registerTool(name: string, config: { description: string }) {
      names.push(name)
      descriptions.set(name, config.description)
    },
  }
  return { server: server as unknown as McpServer, names, descriptions }
}

test('the server registers exactly one tool', () => {
  // The property the whole surface is built on: connecting costs one tool
  // schema, whatever the catalogue behind it grows to.
  const { server, names } = recordingServer()
  registerTools(server)
  assert.deepEqual(names, [TOOL_NAME])
})

test('the real SDK accepts the tool, and registers one of it', () => {
  // The recording server proves what we CALL; this proves the SDK can actually
  // take it — a schema it cannot convert to JSON Schema would pass every other
  // test here and fail at the first `tools/list`.
  const server = new McpServer(mcpServerInfo())
  registerTools(server)
  const registered = (server as unknown as { _registeredTools?: Record<string, unknown> })._registeredTools
  assert.deepEqual(Object.keys(registered ?? {}), [TOOL_NAME])
})

test("the one tool's description teaches the protocol and nothing perishable", () => {
  // A client caches this for the life of a connection, so it must not carry the
  // catalogue, the recipes or any per-space fact — all of which come from the
  // notes, on demand, and change without a deploy.
  const { server, descriptions } = recordingServer()
  registerTools(server)
  const description = descriptions.get(TOOL_NAME) ?? ''

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

  const reads = actions.filter((a) => a.scope === 'context:read').length
  assert.ok(reads > actions.length / 3, 'a context surface that mostly writes is the wrong shape')

  // A name nothing answers must resolve to nothing, not to a default.
  assert.equal(scopeForAction('no_such_action'), null)
  assert.equal(actionByName('no_such_action'), null)
})

test('the load-bearing scope splits survive the collapse to one tool', () => {
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

test('every action validates its own input', () => {
  // The registry is the perimeter, and a schema that accepts anything is a hole
  // in it. Every action that names a space must require one — passing the
  // tenant boundary as an optional argument is how a call ends up somewhere
  // nobody intended.
  for (const def of allActions()) {
    const schema = schemaOf(def)
    assert.ok(schema, `${def.name} has no schema`)
    if ('space_id' in def.input) {
      assert.equal(
        schema.safeParse({}).success,
        false,
        `${def.name} takes a space_id but accepts a call without one`,
      )
    }
  }
})

test('every catalogue scope has consent copy', () => {
  // The consent page renders it unconditionally.
  for (const scope of MCP_SCOPES) {
    assert.ok(SCOPE_DESCRIPTIONS[scope]?.length > 20, `${scope} has no readable consent description`)
  }
})
