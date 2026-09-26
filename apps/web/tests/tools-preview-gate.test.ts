/**
 * An unreviewed draft never runs with more reach than its authors have
 * (lib/tools/draftAuthors.ts). A preview's target carries every other author
 * of the draft since its last approval, and the bridge allows a read or write
 * only when the viewer AND each of them could make it — so a member cannot
 * hand an admin the preview link and borrow the admin's reach.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { handleBridgeCall, type BridgeDeps } from '@/lib/tools/bridge'
import { resolveBridgeTarget, type ResolvedTarget, type TargetDeps } from '@/lib/tools/target'
import { EMPTY_PERIMETER, type ToolPerimeter } from '@/lib/tools/perimeter'
import { nobodyPrincipal } from '@/lib/tools/draftAuthors'
import { LEVEL_EDIT, OPEN_ACCESS, type ContextAccess } from '@/lib/notes/shared/authz'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { NoteMeta } from '@/lib/notes/shared/types'
import type { ResolvedContext } from '@/lib/notes/resolve'
import type { BridgeResponse } from '@/lib/tools/protocol'
import type { SessionPayload } from '@/lib/session'

const SPACE = 'space-1'

/** Reads and edits `deals/` only. */
const DEALS_ONLY: ContextAccess = {
  grants: [{ subjectType: 'user', subjectId: 'member-1', resourcePath: 'deals', level: LEVEL_EDIT }],
  restricted: ['deals', 'board'],
  locked: [],
}

const ADMIN: ContextPrincipal = {
  userId: 'admin-1',
  email: 'admin@local.dev',
  name: 'Admin',
  spaceId: SPACE,
  spaceAdmin: true,
  access: OPEN_ACCESS,
}
const MEMBER: ContextPrincipal = {
  userId: 'member-1',
  email: 'member@local.dev',
  name: 'Member',
  spaceId: SPACE,
  spaceAdmin: false,
  access: DEALS_ONLY,
}

function perimeter(over: Partial<ToolPerimeter> = {}): ToolPerimeter {
  return { ...EMPTY_PERIMETER, read: [], write: [], types: [], connectors: [], agents: [], ...over }
}

const REACH = perimeter({ read: ['**'], write: ['**'], connectors: ['hubspot'], agents: ['digest'] })

/** A member's draft, opened by an admin. */
function preview(over: Partial<ResolvedTarget> = {}): ResolvedTarget {
  return {
    spaceId: SPACE,
    principal: ADMIN,
    coPrincipals: [MEMBER],
    context: { spaceId: SPACE, ownerKey: 'shared' },
    perimeter: REACH,
    config: {
      name: 'deals',
      title: 'Deals',
      description: '',
      version: 0,
      surfaces: { rail: null, types: [] },
      perimeter: REACH,
      tags: [],
      previewUrl: null,
    },
    dataBundle: '',
    installId: null,
    degraded: null,
    install: { preview: true, name: 'deals' },
    isAdmin: true,
    subject: null,
    ...over,
  }
}

function note(path: string): NoteMeta {
  return { path, title: path, folder: '', frontmatter: {}, tags: [], linkTargets: [], unresolved: [], mtime: 0 }
}

function deps(over: Partial<BridgeDeps> = {}): BridgeDeps {
  const trap = (name: string) => () => {
    throw new Error(`${name} was called — the gate should have refused first`)
  }
  return {
    visibleVault: async () => ({ raws: [], metas: [note('deals/acme.md'), note('salaries/pay.md')] }),
    readVisible: trap('readVisible') as never,
    searchContext: trap('searchContext') as never,
    writeGated: trap('writeGated') as never,
    appendLogGated: trap('appendLogGated') as never,
    loadConnector: trap('loadConnector') as never,
    executeConnectorScript: trap('executeConnectorScript') as never,
    canTriggerRun: trap('canTriggerRun') as never,
    claimManualRun: trap('claimManualRun') as never,
    getToolState: trap('getToolState') as never,
    setToolState: trap('setToolState') as never,
    runDataHandler: trap('runDataHandler') as never,
    queryRecords: trap('queryRecords') as never,
    getRecord: trap('getRecord') as never,
    setFields: trap('setFields') as never,
    referencesFor: trap('referencesFor') as never,
    resourceViewer: trap('resourceViewer') as never,
    listResources: trap('listResources') as never,
    loadView: trap('loadView') as never,
    requireVisibleResource: trap('requireVisibleResource') as never,
    readResourceText: trap('readResourceText') as never,
    resourceBlob: trap('resourceBlob') as never,
    receiveFile: trap('receiveFile') as never,
    resourceFolderPath: trap('resourceFolderPath') as never,
    tenantArgDenial: trap('tenantArgDenial') as never,
    runAction: trap('runAction') as never,
    complete: trap('complete') as never,
    decide: trap('decide') as never,
    collections: {
      insert: trap('collections.insert') as never,
      list: trap('collections.list') as never,
      get: trap('collections.get') as never,
      update: trap('collections.update') as never,
      delete: trap('collections.delete') as never,
      count: trap('collections.count') as never,
    },
    logResourceAccess: async () => {},
    logAudit: async () => {},
    ...over,
  }
}

function errorOf(response: BridgeResponse) {
  assert.equal(response.ok, false, `expected a refusal, got ${JSON.stringify(response).slice(0, 200)}`)
  return response.ok ? { code: '', message: '' } : response.error
}

test('a read only the admin could make reads as absent, before the vault is asked', async () => {
  const error = errorOf(await handleBridgeCall(preview(), 'context.read', { path: 'salaries/pay.md' }, deps()))
  assert.equal(error.code, 'not_found')
})

test('a read every author could make goes through', async () => {
  const response = await handleBridgeCall(
    preview(),
    'context.read',
    { path: 'deals/acme.md' },
    deps({ readVisible: async () => '# Acme' }),
  )
  assert.equal(response.ok, true)
})

test('a list shows only what the viewer and every author can all read', async () => {
  const response = await handleBridgeCall(preview(), 'context.list', {}, deps())
  assert.equal(response.ok, true)
  const rows = (response.ok ? response.value : []) as Array<{ path: string }>
  assert.deepEqual(rows.map((r) => r.path), ['deals/acme.md'])
})

test('search drops hits an author could not read', async () => {
  const response = await handleBridgeCall(
    preview(),
    'context.search',
    { query: 'pay' },
    deps({
      searchContext: async () => ({
        hits: [
          { path: 'salaries/pay.md', title: 'Pay', score: 2, kind: 'note' as const, snippet: '' },
          { path: 'deals/acme.md', title: 'Acme', score: 1, kind: 'note' as const, snippet: '' },
        ],
        semantic: 'no-key',
        plan: { text: 'pay', temporalOnly: false, history: false, updatedAfter: null, updatedBefore: null } as never,
      }),
    }),
  )
  const rows = (response.ok ? response.value : []) as Array<{ path: string }>
  assert.deepEqual(rows.map((r) => r.path), ['deals/acme.md'])
})

test('a write only the admin could make is refused before the store', async () => {
  const error = errorOf(
    await handleBridgeCall(preview(), 'context.write', { path: 'salaries/pay.md', content: 'x' }, deps({ readVisible: async () => null })),
  )
  assert.equal(error.code, 'forbidden')
  assert.match(error.message, /reach of the people who wrote it/)
})

test('a connector or agent an author cannot use is refused', async () => {
  const connector = errorOf(
    await handleBridgeCall(
      preview(),
      'connectors.call',
      { name: 'hubspot', action: 'search' },
      deps({ loadConnector: (async (p: ContextPrincipal) => (p.userId === 'admin-1' ? ({} as never) : null)) as never }),
    ),
  )
  assert.equal(connector.code, 'forbidden')
  const agent = errorOf(
    await handleBridgeCall(
      preview(),
      'agents.run',
      { name: 'digest' },
      deps({ canTriggerRun: (async (p: ContextPrincipal) => p.userId === 'admin-1') as never }),
    ),
  )
  assert.equal(agent.code, 'forbidden')
})

test('an author who left the space reaches nothing, so neither does the draft', async () => {
  const gone = nobodyPrincipal(SPACE, { userId: 'gone-1', name: 'Gone' })
  const error = errorOf(
    await handleBridgeCall(preview({ coPrincipals: [gone] }), 'context.read', { path: 'deals/acme.md' }, deps()),
  )
  assert.equal(error.code, 'not_found')
})

test('an install carries no co-authors: reviewed code runs as the viewer', async () => {
  const response = await handleBridgeCall(
    preview({ coPrincipals: undefined, installId: 'install-1' }),
    'context.read',
    { path: 'salaries/pay.md' },
    deps({ readVisible: async () => '# Pay' }),
  )
  assert.equal(response.ok, true)
})

// ── the target ───────────────────────────────────────────────────────────────

const SESSION: SessionPayload = { userId: 'admin-1', name: 'Admin', email: 'admin@local.dev' }

function resolvedContext(): ResolvedContext {
  return {
    spaceId: SPACE,
    ownerKey: 'shared',
    scope: 'shared',
    isAdmin: true,
    isPersonalSpace: false,
    actor: { id: 'admin-1', name: 'Admin', email: 'admin@local.dev' },
  }
}

function targetDeps(over: Partial<TargetDeps> = {}): TargetDeps {
  return {
    findInstall: async () => null,
    findBuild: async () => ({ ok: true, dataBundle: '' }),
    resolveContext: async () => resolvedContext(),
    principalOf: async () => ADMIN,
    readVisible: async () => '---\ntype: tool\ntitle: Deals\n---\n',
    featureAccessForbidden: async () => false,
    toolFolder: async () => 'tools/deals',
    ...over,
  }
}

test('a preview’s target names every other author of the draft', async () => {
  const answer = await resolveBridgeTarget(
    SESSION,
    { kind: 'preview', spaceId: SPACE, name: 'deals' },
    targetDeps({
      draftAuthorship: async () => ({
        authors: [
          { userId: 'admin-1', name: 'Admin' },
          { userId: 'member-1', name: 'Member' },
          { userId: 'gone-1', name: 'Gone' },
        ],
        lastEdit: null,
      }),
      principalForUser: async (_space, userId) => (userId === 'member-1' ? MEMBER : null),
    }),
  )
  assert.equal('code' in answer, false)
  const t = answer as ResolvedTarget
  assert.deepEqual(t.coPrincipals?.map((p) => p.userId), ['member-1', 'gone-1'], 'the viewer is not their own co-author')
  assert.deepEqual(t.coPrincipals?.[1].access.grants, [], 'someone gone reaches nothing')
})

test('the viewer who wrote the whole draft runs it with their own reach', async () => {
  const answer = await resolveBridgeTarget(
    SESSION,
    { kind: 'preview', spaceId: SPACE, name: 'deals' },
    targetDeps({
      draftAuthorship: async () => ({ authors: [{ userId: 'admin-1', name: 'Admin' }], lastEdit: null }),
      principalForUser: async () => assert.fail('no other author to look up'),
    }),
  )
  assert.deepEqual((answer as ResolvedTarget).coPrincipals, [])
})

