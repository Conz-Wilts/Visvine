// The scope invariant for the MCP tool surface: every tool that is actually
// REGISTERED has an entry in TOOL_SCOPES, and every scope it names is in the
// catalogue a token can carry.
//
// This matters more than it looks. The scope check happens twice — once in the
// transport, which answers an under-scoped call with an RFC 6750
// `insufficient_scope` challenge (lib/mcp/challenge.ts), and once in `withCtx`
// as defence in depth. Both read TOOL_SCOPES, and `scopeForTool` returns null
// for a name it doesn't know — so a tool registered without an entry would be
// unreachable rather than open, but unreachable for a reason nobody could see
// from the error. Registering the real surface against a recording server is
// the only way to catch that; a hand-written list of names would drift.
//
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/mcp-scopes.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
import type { McpServer } from '@modelcontextprotocol/server'
import { MCP_SCOPES, SCOPE_DESCRIPTIONS, TOOL_SCOPES, scopeForTool } from '@/lib/mcp/scopes'
import { registerAppTools, type AppToolDeps } from '@/lib/mcp/appTools'
import { registerCreatorTools, registerTools } from '@/lib/mcp/tools'

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

/** Registration never calls a dep, so an empty seam is enough here. */
const NO_DEPS = {} as AppToolDeps

test('every registered tool has a scope, and every scope has a tool', () => {
  // The WHOLE surface across BOTH servers: the context server (registerTools,
  // which ends by registering the discover/install half of the Tool group) and
  // the creator server (registerCreatorTools, the authoring loop). Together
  // this is the set an agent can actually reach.
  const { server, names: contextNames } = recordingServer()
  registerTools(server)
  const { server: creator, names: creatorNames } = recordingServer()
  registerCreatorTools(creator)
  const names = [...new Set([...contextNames, ...creatorNames])]

  assert.ok(contextNames.length > 0, 'registerTools registered nothing')
  assert.ok(creatorNames.length > 0, 'registerCreatorTools registered nothing')
  for (const name of names) {
    const scope = scopeForTool(name)
    assert.ok(scope, `${name} is registered but has no entry in TOOL_SCOPES`)
    assert.ok(MCP_SCOPES.includes(scope), `${name} wants ${scope}, which is not in the catalogue`)
  }
  // The other direction: an entry left behind after a tool was renamed grants a
  // scope to a name nothing answers, and reads as coverage that isn't there.
  const registered = new Set(names)
  for (const name of Object.keys(TOOL_SCOPES)) {
    assert.ok(registered.has(name), `${name} has a scope but is registered nowhere`)
  }
  assert.equal(names.length, Object.keys(TOOL_SCOPES).length)
})

test('the nine Tool tools are split across the two servers by job', () => {
  // The CREATOR server carries the authoring loop — and list_tools, so an
  // author can see what already exists — but NOT install_tool.
  const creator = recordingServer()
  registerAppTools(creator.server, 'creator', NO_DEPS)
  assert.deepEqual(creator.names.sort(), [
    'check_tool',
    'create_tool',
    'get_tool_sdk',
    'list_tools',
    'preview_tool',
    'publish_tool',
    'read_tool',
    'write_tool',
  ])

  // The CONTEXT server only discovers and activates: nothing on it writes a
  // Tool's code.
  const context = recordingServer()
  registerAppTools(context.server, 'context', NO_DEPS)
  assert.deepEqual(context.names.sort(), ['install_tool', 'list_tools'])

  // Reading a tool is reading notes — nothing here that read_context couldn't
  // already fetch, and the SDK is a static document.
  assert.equal(scopeForTool('list_tools'), 'context:read')
  assert.equal(scopeForTool('read_tool'), 'context:read')
  assert.equal(scopeForTool('get_tool_sdk'), 'context:read')

  // Authoring writes executable code into a space, so it is deliberately NOT
  // context:write: a token granted to tidy notes must not be able to add a
  // running app to the sidebar.
  for (const name of ['create_tool', 'write_tool', 'check_tool', 'preview_tool', 'publish_tool']) {
    assert.equal(scopeForTool(name), 'tools:author', `${name} should be tools:author`)
  }

  // Installing runs code nobody in the space wrote — its own scope.
  assert.equal(scopeForTool('install_tool'), 'tools:install')
})

test('the new scopes are in the catalogue and have consent copy', () => {
  for (const scope of ['tools:author', 'tools:install'] as const) {
    assert.ok(MCP_SCOPES.includes(scope), `${scope} is missing from MCP_SCOPES`)
    assert.ok(
      SCOPE_DESCRIPTIONS[scope]?.length > 20,
      `${scope} has no readable description for the consent page`,
    )
  }
  // Every catalogue scope has copy — the consent page renders it unconditionally.
  for (const scope of MCP_SCOPES) {
    assert.ok(SCOPE_DESCRIPTIONS[scope], `${scope} has no consent description`)
  }
})

test('each Tool tool description is written for an LLM author', () => {
  const { server, descriptions } = recordingServer()
  registerAppTools(server, 'creator', NO_DEPS)
  registerAppTools(server, 'context', NO_DEPS)

  for (const [name, description] of descriptions) {
    assert.ok(description.length > 120, `${name}'s description is too thin to author from`)
  }
  // The two rules an agent cannot infer and must be told: where to get the SDK,
  // and that publish/install are admin-gated behind a review.
  assert.match(descriptions.get('create_tool') ?? '', /get_tool_sdk/)
  assert.match(descriptions.get('publish_tool') ?? '', /ADMINS ONLY/)
  assert.match(descriptions.get('publish_tool') ?? '', /review/i)
  assert.match(descriptions.get('install_tool') ?? '', /ADMINS ONLY/)
})

test('the creator server is list_spaces + authoring; the context server never carries authoring', () => {
  const creator = recordingServer()
  registerCreatorTools(creator.server)
  assert.deepEqual(creator.names.sort(), [
    'check_tool',
    'create_tool',
    'get_tool_sdk',
    'list_spaces',
    'list_tools',
    'preview_tool',
    'publish_tool',
    'read_tool',
    'write_tool',
  ])

  const context = recordingServer()
  registerTools(context.server)
  for (const name of ['create_tool', 'write_tool', 'check_tool', 'preview_tool', 'publish_tool', 'read_tool', 'get_tool_sdk']) {
    assert.ok(!context.names.includes(name), `${name} must not be on the context server`)
  }
  for (const name of ['list_spaces', 'list_context', 'search_context', 'list_tools', 'install_tool']) {
    assert.ok(context.names.includes(name), `${name} must be on the context server`)
  }
})
