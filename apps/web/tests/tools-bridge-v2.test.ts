/**
 * Bridge v2 — records, resources, links, actions, the space's AI, state
 * scopes. The assertions that matter are WHEN each refusal happens: every
 * dependency below throws if called, so a passing refusal proves the Tool's
 * permission gate ran before any of the viewer's own access was asked.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-bridge-v2.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { handleBridgeCall, type BridgeDeps } from '@/lib/tools/bridge'
import type { ResolvedTarget } from '@/lib/tools/target'
import { EMPTY_PERIMETER } from '@/lib/tools/perimeter'
import { BRIDGE_METHODS, type BridgeMethod, type BridgeResponse } from '@/lib/tools/protocol'
import { planToolAction, TOOL_ACTIONS } from '@/lib/tools/actionAllowlist'
import type { ToolReach } from '@visvine/tool-protocol/bindings'
import { OPEN_ACCESS } from '@/lib/notes/shared/authz'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'

const VIEWER: ContextPrincipal = {
  userId: 'user-1',
  email: 'viewer@local.dev',
  name: 'Viewer',
  spaceId: 'space-1',
  spaceAdmin: false,
  access: OPEN_ACCESS,
}

const NOTHING: ToolReach = {
  ...EMPTY_PERIMETER,
  records: { read: [], write: [] },
  resources: { read: [] },
  connectorActions: {},
  actions: [],
  ai: { complete: false, decide: false },
  ui: { download: false },
}

function reach(over: Partial<ToolReach> = {}): ToolReach {
  return { ...NOTHING, ...over }
}

function target(r: ToolReach = NOTHING, over: Partial<ResolvedTarget> = {}): ResolvedTarget {
  const perimeter = { read: r.read, write: r.write, types: r.types, connectors: r.connectors, agents: r.agents }
  return {
    spaceId: 'space-1',
    principal: VIEWER,
    context: { spaceId: 'space-1', ownerKey: 'shared' },
    perimeter,
    reach: r,
    config: {
      name: 'deals',
      title: 'Deals',
      description: '',
      version: 1,
      surfaces: { rail: null, types: [] },
      perimeter,
      tags: [],
      previewUrl: null,
    },
    dataBundle: '',
    installId: 'install-1',
    degraded: null,
    install: { slug: 'deals', title: 'Deals', key: 'space-1/deals' },
    isAdmin: false,
    subject: null,
    ...over,
  }
}

/** Every dependency throws: a refusal that passes proves none was reached. */
function deps(over: Partial<BridgeDeps> = {}): BridgeDeps {
  const trap = (name: string) => () => {
    throw new Error(`${name} was called — the permission gate should have refused first`)
  }
  const names: Array<keyof BridgeDeps> = [
    'visibleVault', 'readVisible', 'searchContext', 'writeGated', 'appendLogGated', 'loadConnector',
    'executeConnectorScript', 'canTriggerRun', 'claimManualRun', 'getToolState', 'setToolState', 'runDataHandler',
    'queryRecords', 'getRecord', 'setFields', 'referencesFor', 'resourceViewer', 'listResources', 'loadView',
    'requireVisibleResource', 'readResourceText', 'resourceBlob', 'tenantArgDenial', 'runAction', 'complete', 'decide',
  ]
  const base = Object.fromEntries(names.map((n) => [n, trap(n)])) as unknown as BridgeDeps
  return { ...base, logAudit: async () => {}, logResourceAccess: async () => {}, ...over }
}

function refusal(response: BridgeResponse): { code: string; message: string } {
  assert.equal(response.ok, false, `expected a refusal, got ${JSON.stringify(response).slice(0, 200)}`)
  return response.ok ? { code: '', message: '' } : response.error
}

/** Params that pass each method's own validation, so the permission gate is what answers. */
const VALID: Partial<Record<BridgeMethod, unknown>> = {
  'context.list': {},
  'context.read': { path: 'deals/acme.md' },
  'context.search': { query: 'acme' },
  'context.write': { path: 'deals/acme.md', content: '# Acme' },
  'context.append': { path: 'deals/acme.md', text: 'more' },
  'context.links': { path: 'deals/acme.md' },
  'connectors.call': { name: 'hubspot', code: 'return 1' },
  'agents.run': { name: 'digest' },
  'records.query': { type: 'Deal' },
  'records.get': { path: 'deals/acme.md' },
  'records.update': { path: 'deals/acme.md', fields: { stage: 'Won' } },
  'resources.list': {},
  'resources.get': { id: 'res-1' },
  'resources.read': { id: 'res-1' },
  'resources.blob': { id: 'res-1' },
  'actions.run': { name: 'list_events', input: {} },
  'ai.complete': { prompt: 'Summarise' },
  'ai.decide': { items: ['a'], questions: [{ id: 'q', ask: 'It is urgent' }] },
}

/** Methods that carry no permission of their own: the Tool's own code, state and subject. */
const UNGATED = new Set<BridgeMethod>(['data.call', 'state.get', 'state.set', 'subject.get'])

test('every gated bridge method refuses a Tool that declared nothing — before the viewer\'s access is asked', async () => {
  for (const method of BRIDGE_METHODS) {
    if (UNGATED.has(method)) continue
    assert.ok(method in VALID, `${method} needs valid params in this test`)
    const error = refusal(await handleBridgeCall(target(), method, VALID[method], deps()))
    assert.equal(error.code, 'perimeter', `${method} answered ${error.code}: ${error.message}`)
  }
})

test('a declared reach reaches the grant check — the order is permission, then access', async () => {
  let asked = false
  const response = await handleBridgeCall(
    target(reach({ records: { read: ['Deal'], write: [] } })),
    'records.query',
    { type: 'Deal' },
    deps({
      queryRecords: async () => {
        asked = true
        return { ok: false, status: 403, error: 'You may not read these.' }
      },
    }),
  )
  assert.equal(asked, true)
  assert.equal(refusal(response).code, 'forbidden')
})

test('records: a type outside records.read is refused; one inside is queried as the viewer', async () => {
  const r = reach({ records: { read: ['Deal'], write: [] } })
  assert.equal(refusal(await handleBridgeCall(target(r), 'records.query', { type: 'Invoice' }, deps())).code, 'perimeter')
  const seen: unknown[] = []
  const ok = await handleBridgeCall(
    target(r),
    'records.query',
    { type: 'deal', where: [{ key: 'stage', op: 'eq', value: 'Won' }] },
    deps({
      queryRecords: async (p, _c, q) => {
        seen.push(p.userId, q.type)
        return { ok: true, type: 'Deal', rows: [], nextCursor: null, total: 0 }
      },
    }),
  )
  assert.equal(ok.ok, true)
  assert.deepEqual(seen, ['user-1', 'deal'])
})

test('records.update writes only the fields records.write names, and a Tool with ai writes AI-assisted', async () => {
  const record = { path: 'deals/acme.md', type: 'Deal', title: 'Acme', tags: [], updatedAt: '', fields: {}, invalid: [] }
  const r = reach({ records: { read: [], write: [{ type: 'Deal', fields: ['stage'] }] }, ai: { complete: true, decide: false } })
  const outside = await handleBridgeCall(
    target(r),
    'records.update',
    { path: 'deals/acme.md', fields: { amount: 5 } },
    deps({ getRecord: async () => ({ ok: true, record }) }),
  )
  assert.equal(refusal(outside).code, 'perimeter')

  let origin: unknown = null
  const inside = await handleBridgeCall(
    target(r, { perimeter: { ...EMPTY_PERIMETER } }),
    'records.update',
    { path: 'deals/acme.md', fields: { stage: 'Won' } },
    deps({
      getRecord: async () => ({ ok: true, record }),
      setFields: async (_p, _c, _t, fields, opts) => {
        origin = opts?.origin
        return { ok: true, record: 'deals/acme.md', fields }
      },
    }),
  )
  assert.equal(inside.ok, true)
  assert.equal(origin, 'ai-enrich', 'a Tool that may ask the AI writes under the origin Freeze for AI refuses')
})

test('a Tool without ai writes as a person edits', async () => {
  let origin: unknown = null
  const response = await handleBridgeCall(
    target(reach({ write: ['deals/**'] })),
    'context.write',
    { path: 'deals/acme.md', content: '# Acme' },
    deps({
      readVisible: async () => null,
      writeGated: async (_p, _c, path, _content, o) => {
        origin = o
        return { status: 'applied', path }
      },
    }),
  )
  assert.equal(response.ok, true)
  assert.equal(origin, 'edit')
})

test('resources: a file outside resources.read is refused after it is found, and one the viewer cannot see is absent', async () => {
  const r = reach({ resources: { read: ['resources/contracts/**'] } })
  const view = { id: 'res-1', name: 'NDA.pdf', kind: 'pdf', source: 'upload', mimeType: 'application/pdf', fileSize: 10, url: null, notePath: 'resources/design/nda/index.md', hasText: true, createdAt: '' }
  const outside = await handleBridgeCall(
    target(r),
    'resources.get',
    { id: 'res-1' },
    deps({
      requireVisibleResource: (async () => ({ spaceId: 'space-1', viewer: {} })) as never,
      loadView: (async () => view) as never,
    }),
  )
  assert.equal(refusal(outside).code, 'perimeter')

  const hidden = await handleBridgeCall(
    target(r),
    'resources.get',
    { id: 'res-1' },
    deps({
      requireVisibleResource: (async () => {
        throw new Error('Not found')
      }) as never,
    }),
  )
  assert.equal(refusal(hidden).code, 'not_found')

  const otherSpace = await handleBridgeCall(
    target(r),
    'resources.get',
    { id: 'res-1' },
    deps({ requireVisibleResource: (async () => ({ spaceId: 'space-2', viewer: {} })) as never }),
  )
  assert.equal(refusal(otherSpace).code, 'not_found')
})

test('actions.run naming another space is refused, before anything is looked up or run', async () => {
  const r = reach({ actions: ['list_events'] })
  const error = refusal(
    await handleBridgeCall(target(r), 'actions.run', { name: 'list_events', input: { space_id: 'space-2' } }, deps()),
  )
  assert.equal(error.code, 'forbidden')
  assert.match(error.message, /only in the space it is installed in/)
})

test('actions.run: undeclared, off the allowlist, or naming a thing outside the space — each refused', async () => {
  assert.equal(refusal(await handleBridgeCall(target(reach({ actions: [] })), 'actions.run', { name: 'list_events' }, deps())).code, 'perimeter')
  assert.equal(
    refusal(await handleBridgeCall(target(reach({ actions: ['read_context'] })), 'actions.run', { name: 'read_context' }, deps())).code,
    'perimeter',
  )
  const foreign = await handleBridgeCall(
    target(reach({ actions: ['share_resource'] })),
    'actions.run',
    { name: 'share_resource', input: { resource_id: 'res-9', channel_id: 'ch-1' } },
    deps({ tenantArgDenial: async () => ({ code: 'not_found', message: 'No such file here.' }) }),
  )
  assert.equal(refusal(foreign).code, 'not_found')
})

test('actions.run runs as the viewer, with that action\'s scope alone, in the install\'s space', async () => {
  let call: { caller: { userId: string; scopes: string[]; via?: string }; name: string; input: unknown } | null = null
  const response = await handleBridgeCall(
    target(reach({ actions: ['list_events'] })),
    'actions.run',
    { name: 'list_events', input: {} },
    deps({
      tenantArgDenial: async () => null,
      runAction: async (caller, name, input) => {
        call = { caller, name, input }
        return { events: [] }
      },
    }),
  )
  assert.equal(response.ok, true)
  assert.ok(call)
  const made = call as unknown as { caller: { userId: string; scopes: string[]; via?: string }; name: string; input: Record<string, unknown> }
  assert.equal(made.caller.userId, 'user-1')
  assert.equal(made.caller.via, 'tool')
  assert.deepEqual(made.caller.scopes, ['context:read'])
  assert.equal(made.input.space_id, 'space-1')
})

test('the allowlist is small and never includes a read the bridge gates, or anything that governs', () => {
  const forbidden = ['read_context', 'search_context', 'list_resources', 'read_resource', 'edit_context', 'create_agent', 'activate_agent', 'create_tool', 'install_tool', 'set_connector_secret', 'manage_alias', 'create_space', 'vm_exec', 'delegate']
  for (const name of forbidden) assert.ok(!(name in TOOL_ACTIONS), `${name} must not be an action a tool may run`)
  assert.deepEqual(Object.keys(TOOL_ACTIONS).sort(), ['list_events', 'share_resource', 'update_event'])
  const planned = planToolAction('update_event', { event_id: 'event:x', cover_resource_id: 'res-1' }, 'space-1')
  assert.ok(planned.ok)
  assert.deepEqual(planned.ok && planned.tenantArgs.map((a) => a.thing).sort(), ['event', 'resource'])
  assert.equal(planned.ok && planned.input.space_id, 'space-1')
  assert.equal(planToolAction('share_resource', { resource_id: 5 }, 'space-1').ok, false)
})

test('ai: each half needs its own declaration, and the answer comes back as text', async () => {
  assert.equal(
    refusal(await handleBridgeCall(target(reach({ ai: { complete: false, decide: true } })), 'ai.complete', { prompt: 'x' }, deps())).code,
    'perimeter',
  )
  let asked: unknown = null
  const response = await handleBridgeCall(
    target(reach({ ai: { complete: true, decide: false } })),
    'ai.complete',
    { system: 'Be brief', prompt: 'Summarise' },
    deps({
      complete: async (input) => {
        asked = input
        return { ok: true, text: 'Done.' }
      },
    }),
  )
  assert.deepEqual(response, { ok: true, value: { text: 'Done.' } })
  assert.deepEqual((asked as { messages: unknown[] }).messages, [
    { role: 'system', content: 'Be brief' },
    { role: 'user', content: 'Summarise' },
  ])
})

test('state takes a scope, and a call naming none keeps the shared value a kit-1 Tool always had', async () => {
  const scopes: string[] = []
  const record = deps({
    getToolState: async (_t, _key, scope) => {
      scopes.push(`get:${scope}`)
      return null
    },
    setToolState: async (_t, _key, _value, scope) => {
      scopes.push(`set:${scope}`)
      return { ok: true }
    },
  })
  await handleBridgeCall(target(), 'state.get', { key: 'filter' }, record)
  await handleBridgeCall(target(), 'state.get', { key: 'filter', scope: 'user' }, record)
  await handleBridgeCall(target(), 'state.set', { key: 'filter', value: 1, scope: 'user' }, record)
  assert.deepEqual(scopes, ['get:install', 'get:user', 'set:user'])
  assert.equal(refusal(await handleBridgeCall(target(), 'state.get', { key: 'x', scope: 'space' }, record)).code, 'invalid')
})

test('context.links reports only notes the Tool may read, and nothing of the rest', async () => {
  const r = reach({ read: ['deals/**'] })
  const meta = (path: string) => ({ path, title: path, folder: '', frontmatter: {}, tags: [], linkTargets: [], unresolved: [], mtime: 0 })
  const response = await handleBridgeCall(
    target(r),
    'context.links',
    { path: 'deals/acme.md' },
    deps({
      readVisible: async () => 'See [Beta](beta.md) and [Pay](../salaries/pay.md).',
      visibleVault: async () => ({ raws: [], metas: [meta('deals/acme.md'), meta('deals/beta.md'), meta('salaries/pay.md')] }),
      referencesFor: async () => ({
        linked: [
          { fromPath: 'deals/beta.md', fromTitle: 'Beta', date: 0, excerpt: 'links Acme' },
          { fromPath: 'salaries/pay.md', fromTitle: 'Pay', date: 0, excerpt: 'secret' },
        ],
        unlinked: [],
        restricted: [{ token: 't', date: 0, kind: 'linked', pending: false }],
      }),
    }),
  )
  assert.equal(response.ok, true)
  const value = (response.ok ? response.value : null) as { outgoing: Array<{ path: string }>; incoming: Array<{ path: string }> }
  assert.deepEqual(value.outgoing.map((l) => l.path), ['deals/beta.md'])
  assert.deepEqual(value.incoming.map((l) => l.path), ['deals/beta.md'])
})

test('connectors: named actions bind the call, and a Tool from outside the space never sends code', async () => {
  const declared = reach({ connectors: ['hubspot'], connectorActions: { hubspot: ['search_deals'] } })
  const code = await handleBridgeCall(target(declared), 'connectors.call', { name: 'hubspot', code: 'return 1' }, deps())
  assert.equal(refusal(code).code, 'perimeter')
  const other = await handleBridgeCall(target(declared), 'connectors.call', { name: 'hubspot', action: 'delete_all' }, deps())
  assert.equal(refusal(other).code, 'perimeter')

  const open = reach({ connectors: ['hubspot'], connectorActions: { hubspot: null } })
  const foreignCode = await handleBridgeCall(target(open, { foreign: true }), 'connectors.call', { name: 'hubspot', code: 'return 1' }, deps())
  assert.match(refusal(foreignCode).message, /named actions, never code/)
  const foreignUnnamed = await handleBridgeCall(target(open, { foreign: true }), 'connectors.call', { name: 'hubspot', action: 'search_deals' }, deps())
  assert.match(refusal(foreignUnnamed).message, /must name the actions/)

  let ran: unknown = null
  const home = await handleBridgeCall(
    target(open),
    'connectors.call',
    { name: 'hubspot', code: 'return 1' },
    deps({
      loadConnector: (async () => ({ name: 'hubspot' })) as never,
      executeConnectorScript: (async (_loaded: unknown, run: unknown) => {
        ran = run
        return { ok: true, value: 1, logs: [], error: null, truncated: false, timedOut: false, denials: [], durationMs: 1 }
      }) as never,
    }),
  )
  assert.equal(home.ok, true, 'a Tool its own space wrote may still send code to a connector it declared without actions')
  assert.deepEqual(ran, { code: 'return 1' })
})
