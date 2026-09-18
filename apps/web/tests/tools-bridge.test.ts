/**
 * The bridge — the only door from a running Tool to Visvine data.
 *
 * The assertions that matter here are the refusals, and specifically WHEN they
 * happen: every default dependency below throws if it is called, so a test that
 * passes proves the perimeter refused before contextService, the connector
 * runtime or the agent scheduler was ever reached. A gate that ran after the
 * read would still "return an error" while having already done the thing.
 *
 * The last two tests run a REAL QuickJS isolate, because the promise `data.js`
 * makes an author is that it reaches exactly what `ui.tsx` reaches: the same
 * capability names, the same perimeter, the same refusal text.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-bridge.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { bridgeCapabilities, handleBridgeCall, type BridgeDeps } from '@/lib/tools/bridge'
import { runDataHandler } from '@/lib/tools/dataRun'
import {
  resetPreviewToolState,
  getToolState,
  setToolState,
  STATE_MAX_BYTES,
  STATE_MAX_KEYS,
  type StateSetResult,
} from '@/lib/tools/state'
import { resetBridgeLimits } from '@/lib/tools/limits'
import { resolveBridgeTarget, type ResolvedTarget, type TargetDeps } from '@/lib/tools/target'
import { EMPTY_PERIMETER, type ToolPerimeter } from '@/lib/tools/perimeter'
import { BRIDGE_LIMITS, type BridgeError, type BridgeMethod, type BridgeResponse } from '@/lib/tools/protocol'
import { OPEN_ACCESS } from '@/lib/notes/shared/authz'
import type { NoteMeta } from '@/lib/notes/shared/types'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { SessionPayload } from '@/lib/session'
import type { ResolvedContext } from '@/lib/notes/resolve'

/** The plan a stubbed search reports: the query as asked, nothing inferred. */
const PLAN = {
  queries: ['q'],
  topic: 'q',
  dateRange: null,
  temporalOnly: false,
  intent: 'current' as const,
}

// ── fixtures ──────────────────────────────────────────────────────────────────

const VIEWER: ContextPrincipal = {
  userId: 'user-1',
  email: 'viewer@local.dev',
  name: 'Viewer',
  spaceId: 'space-1',
  spaceAdmin: false,
  access: OPEN_ACCESS,
}

function perimeter(over: Partial<ToolPerimeter> = {}): ToolPerimeter {
  return { ...EMPTY_PERIMETER, read: [], write: [], types: [], connectors: [], agents: [], ...over }
}

function target(over: Partial<ResolvedTarget> = {}): ResolvedTarget {
  const p = over.perimeter ?? perimeter()
  return {
    spaceId: 'space-1',
    principal: VIEWER,
    context: { spaceId: 'space-1', ownerKey: 'shared' },
    perimeter: p,
    config: {
      name: 'deals',
      title: 'Deals',
      description: '',
      version: 1,
      surfaces: { rail: null, types: [] },
      perimeter: p,
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

/** Every dependency, wired to fail the test if the gate lets a call through. */
function deps(over: Partial<BridgeDeps> = {}): BridgeDeps {
  const forbidden = (name: string) => () => {
    throw new Error(`${name} was called — the gate should have refused first`)
  }
  const base = {
    visibleVault: forbidden('visibleVault'),
    readVisible: forbidden('readVisible'),
    searchContext: forbidden('searchContext'),
    writeGated: forbidden('writeGated'),
    appendLogGated: forbidden('appendLogGated'),
    loadConnector: forbidden('loadConnector'),
    executeConnectorScript: forbidden('executeConnectorScript'),
    canTriggerRun: forbidden('canTriggerRun'),
    claimManualRun: forbidden('claimManualRun'),
    getToolState: forbidden('getToolState'),
    setToolState: forbidden('setToolState'),
    runDataHandler: forbidden('runDataHandler'),
    // Auditing is a record, never a gate: it is a no-op rather than a trap.
    logAudit: async () => {},
  }
  return { ...(base as unknown as BridgeDeps), ...over }
}

function note(path: string, over: Partial<NoteMeta> = {}): NoteMeta {
  return {
    path,
    title: path.split('/').pop()!.replace(/\.md$/, ''),
    folder: path.split('/').slice(0, -1).join('/'),
    frontmatter: {},
    tags: [],
    linkTargets: [],
    unresolved: [],
    mtime: Date.UTC(2026, 7, 18),
    ...over,
  }
}

/** The error on a response the test expects to have failed. */
function errorOf(response: BridgeResponse): { code: string; message: string } {
  assert.equal(response.ok, false, `expected a refusal, got ${JSON.stringify(response)}`)
  return response.ok ? { code: '', message: '' } : response.error
}

/** The value on a response the test expects to have succeeded. */
function valueOf(response: BridgeResponse): unknown {
  assert.equal(response.ok, true, `expected success, got ${JSON.stringify(response)}`)
  return response.ok ? response.value : null
}

test.beforeEach(() => {
  resetBridgeLimits()
  resetPreviewToolState()
})

// ── the perimeter refuses first, per method ───────────────────────────────────

const UNDECLARED: Array<[BridgeMethod, unknown]> = [
  ['context.list', {}],
  ['context.read', { path: 'salaries/pay.md' }],
  ['context.search', { query: 'pay' }],
  ['context.write', { path: 'salaries/pay.md', content: '# x' }],
  ['context.append', { path: 'salaries/pay.md', text: 'x' }],
  ['connectors.call', { name: 'hubspot', code: 'return 1' }],
  ['agents.run', { name: 'nightly' }],
]

for (const [method, params] of UNDECLARED) {
  test(`${method} is refused when the tool declared nothing`, async () => {
    const response = await handleBridgeCall(target(), method, params, deps())
    const error = errorOf(response)
    assert.equal(error.code, 'perimeter')
    assert.match(error.message, /declares no/)
  })
}

test('a declared perimeter still refuses what it does not name', async () => {
  const t = target({ perimeter: perimeter({ read: ['deals/**'], write: ['deals/**'] }) })
  const read = errorOf(await handleBridgeCall(t, 'context.read', { path: 'salaries/pay.md' }, deps()))
  assert.equal(read.code, 'perimeter')
  assert.match(read.message, /salaries\/pay\.md is not in this tool's read globs \(deals\/\*\*\)/)

  const write = errorOf(await handleBridgeCall(t, 'context.write', { path: 'salaries/pay.md', content: '' }, deps()))
  assert.equal(write.code, 'perimeter')
  assert.match(write.message, /write globs/)
})

test('read and write are independent — reading a note does not let a tool write it', async () => {
  const t = target({ perimeter: perimeter({ read: ['deals/**'] }) })
  const response = await handleBridgeCall(t, 'context.write', { path: 'deals/acme.md', content: '# a' }, deps())
  const error = errorOf(response)
  assert.equal(error.code, 'perimeter')
  assert.match(error.message, /declares no write globs/)
})

test('a connector the tool did not name is refused before it is loaded', async () => {
  const t = target({ perimeter: perimeter({ connectors: ['hubspot'] }) })
  const error = errorOf(await handleBridgeCall(t, 'connectors.call', { name: 'stripe', code: 'return 1' }, deps()))
  assert.equal(error.code, 'perimeter')
  assert.match(error.message, /stripe is not in this tool's connectors \(hubspot\)/)
})

test('an agent the tool did not name is refused before any scheduler call', async () => {
  const t = target({ perimeter: perimeter({ agents: ['deal-*'] }) })
  const error = errorOf(await handleBridgeCall(t, 'agents.run', { name: 'payroll' }, deps()))
  assert.equal(error.code, 'perimeter')
  assert.match(error.message, /payroll is not in this tool's agents/)
})

// ── paths ─────────────────────────────────────────────────────────────────────

test('a traversal path is refused as invalid, never matched against a glob', async () => {
  const t = target({ perimeter: perimeter({ read: ['deals/**'], write: ['deals/**'] }) })
  for (const path of ['deals/../salaries/pay.md', 'deals/./pay.md', 'deals\\pay.md', '//deals//pay.md']) {
    const error = errorOf(await handleBridgeCall(t, 'context.read', { path }, deps()))
    assert.equal(error.code, 'invalid', `${path} should be invalid`)
  }
})

test('a leading slash is normalised rather than refused', async () => {
  const t = target({ perimeter: perimeter({ read: ['deals/**'] }) })
  const response = await handleBridgeCall(
    t,
    'context.read',
    { path: '/deals/acme.md' },
    deps({ readVisible: async (_p, _c, path) => (path === 'deals/acme.md' ? '# Acme' : null) }),
  )
  assert.deepEqual(valueOf(response), { path: 'deals/acme.md', content: '# Acme', frontmatter: {} })
})

test('a tool writes markdown notes only', async () => {
  const t = target({ perimeter: perimeter({ write: ['deals/**'] }) })
  const error = errorOf(await handleBridgeCall(t, 'context.write', { path: 'deals/acme.json', content: '{}' }, deps()))
  assert.equal(error.code, 'invalid')
  assert.match(error.message, /must end in \.md/)
})

test('the executable namespaces are sealed even when the perimeter names them', async () => {
  const t = target({ perimeter: perimeter({ write: ['**'] }) })
  for (const path of ['tools/other/ui.md', 'agents/nightly/index.md', 'agents/nightly/report.md', 'connectors/stripe.md']) {
    const error = errorOf(await handleBridgeCall(t, 'context.write', { path, content: '# x' }, deps()))
    assert.equal(error.code, 'forbidden', `${path} must be sealed`)
    assert.match(error.message, /holds configuration that runs/)
  }
})

// ── the one hole in the seal: an agent brief the tool declared ────────────────
//
// A brief is not the thing that runs — `active:` in its frontmatter is, and a
// Tool-written brief carrying it is refused, so what a Tool creates is
// something a person still has to switch on (claimManualRun refuses an
// inactive agent). Every other shape stays sealed, and the create-only rule is
// what keeps a Tool from rewriting instructions someone already approved. See
// bridge.ts#agentBriefExemption.

/** A perimeter that reaches all of agents/, so the SEAL is what refuses below — not a glob. */
const BRIEF_AUTHOR = perimeter({ write: ['agents/**'], agents: ['wayfinder-*', 'nightly'] })

test('a tool may create the brief of an agent its perimeter names', async () => {
  const audits: Array<{ path: string; detail?: string }> = []
  const response = await handleBridgeCall(
    target({ perimeter: BRIEF_AUTHOR }),
    'context.write',
    { path: 'agents/wayfinder-057/index.md', content: '---\ntype: agent\n---\n\nWork task 057.' },
    deps({
      readVisible: async () => null,
      writeGated: async (_p, _c, path) => ({ status: 'applied', path }),
      logAudit: async (_spaceId, entry) => {
        audits.push(entry)
      },
    }),
  )
  assert.deepEqual(valueOf(response), { path: 'agents/wayfinder-057/index.md' })
  assert.match(audits[0]?.detail ?? '', /tool:deals write/)
})

test('a brief the tool did not declare stays sealed', async () => {
  const t = target({ perimeter: BRIEF_AUTHOR })
  const error = errorOf(await handleBridgeCall(t, 'context.write', { path: 'agents/payroll/index.md', content: '# x' }, deps()))
  assert.equal(error.code, 'forbidden')
  assert.match(error.message, /does not name the agent "payroll"/)
})

test('a wildcard-only agents perimeter names nobody, so it authors nothing', async () => {
  const t = target({ perimeter: perimeter({ write: ['agents/**'], agents: ['*'] }) })
  const error = errorOf(await handleBridgeCall(t, 'context.write', { path: 'agents/nightly/index.md', content: '# x' }, deps()))
  assert.equal(error.code, 'forbidden')
  assert.match(error.message, /a bare "\*" names nobody/)
})

test('nothing else in the folder is a brief — a sibling note is sealed whatever the tool declares', async () => {
  const t = target({ perimeter: BRIEF_AUTHOR })
  const error = errorOf(
    await handleBridgeCall(t, 'context.write', { path: 'agents/nightly/activation.md', content: 'active: true' }, deps()),
  )
  assert.equal(error.code, 'forbidden')
  assert.match(error.message, /only a brief at agents\/<name>\/index\.md is exempt/)
})

test('a tool cannot ship an agent already switched on', async () => {
  // The brief carries the activation now, so the exemption has to be enforced
  // on the content: `active: true` would be the Tool starting the agent.
  const error = errorOf(
    await handleBridgeCall(
      target({ perimeter: BRIEF_AUTHOR }),
      'context.write',
      { path: 'agents/nightly/index.md', content: '---\ntype: agent\nactive: true\nschedule: hourly\n---\n\nRun forever.' },
      deps({ readVisible: async () => null, writeGated: async () => assert.fail('the store must not be reached') }),
    ),
  )
  assert.equal(error.code, 'forbidden')
  assert.match(error.message, /active: true/)
})

test('a brief that already exists is never rewritten, only created', async () => {
  const t = target({ perimeter: BRIEF_AUTHOR })
  const error = errorOf(
    await handleBridgeCall(
      t,
      'context.write',
      { path: 'agents/nightly/index.md', content: '# replaced' },
      // writeGated stays a trap: the refusal must happen before the store is reached.
      deps({ readVisible: async () => '---\ntype: agent\n---\n\nThe brief an admin approved.' }),
    ),
  )
  assert.equal(error.code, 'forbidden')
  assert.match(error.message, /never change one/)
})

test('a tool cannot append to a brief either', async () => {
  const t = target({ perimeter: BRIEF_AUTHOR })
  const error = errorOf(
    await handleBridgeCall(t, 'context.append', { path: 'agents/nightly.md', text: 'also do this' }, deps()),
  )
  assert.equal(error.code, 'forbidden')
  assert.match(error.message, /never append to one/)
})

// ── caps ──────────────────────────────────────────────────────────────────────

test('context.list refuses a pathological caller-supplied glob before touching the vault', async () => {
  const t = target({ perimeter: perimeter({ read: ['**'] }) })
  const response = await handleBridgeCall(t, 'context.list', { glob: '**/a*/**/a*/**/x' }, deps())
  const error = errorOf(response)
  assert.equal(error.code, 'invalid')
  assert.match(error.message, /is not a usable glob/)
})

test('context.list is capped at maxRows and only lists what the perimeter names', async () => {
  const metas = [
    ...Array.from({ length: BRIDGE_LIMITS.maxRows + 50 }, (_, i) => note(`deals/${String(i).padStart(4, '0')}.md`)),
    note('salaries/pay.md'),
  ]
  const response = await handleBridgeCall(
    target({ perimeter: perimeter({ read: ['deals/**'] }) }),
    'context.list',
    {},
    deps({ visibleVault: async () => ({ raws: [], metas }) }),
  )
  const rows = valueOf(response) as Array<{ path: string }>
  assert.equal(rows.length, BRIDGE_LIMITS.maxRows)
  assert.equal(rows.every((row) => row.path.startsWith('deals/')), true)
})

test('context.list narrows by its own glob, within the perimeter', async () => {
  const metas = [note('deals/acme/index.md'), note('deals/other.md'), note('salaries/pay.md')]
  const response = await handleBridgeCall(
    target({ perimeter: perimeter({ read: ['deals/**', 'salaries/**'] }) }),
    'context.list',
    { glob: 'deals/*/index.md' },
    deps({ visibleVault: async () => ({ raws: [], metas }) }),
  )
  assert.deepEqual((valueOf(response) as Array<{ path: string }>).map((r) => r.path), ['deals/acme/index.md'])
})

test('a list row carries the note type and an ISO timestamp', async () => {
  const metas = [note('deals/acme.md', { title: 'Acme', frontmatter: { type: 'deal' }, mtime: 1_700_000_000_000 })]
  const response = await handleBridgeCall(
    target({ perimeter: perimeter({ read: ['deals/**'] }) }),
    'context.list',
    {},
    deps({ visibleVault: async () => ({ raws: [], metas }) }),
  )
  assert.deepEqual(valueOf(response), [
    { path: 'deals/acme.md', title: 'Acme', type: 'deal', updatedAt: new Date(1_700_000_000_000).toISOString() },
  ])
})

test('an oversized note comes back as too_large rather than truncated', async () => {
  const content = 'x'.repeat(BRIDGE_LIMITS.maxReadBytes + 1)
  const error = errorOf(
    await handleBridgeCall(
      target({ perimeter: perimeter({ read: ['deals/**'] }) }),
      'context.read',
      { path: 'deals/big.md' },
      deps({ readVisible: async () => content }),
    ),
  )
  assert.equal(error.code, 'too_large')
})

test('an oversized write is refused before it reaches the store', async () => {
  const error = errorOf(
    await handleBridgeCall(
      target({ perimeter: perimeter({ write: ['deals/**'] }) }),
      'context.write',
      { path: 'deals/big.md', content: 'x'.repeat(BRIDGE_LIMITS.maxWriteBytes + 1) },
      deps(),
    ),
  )
  assert.equal(error.code, 'too_large')
})

test('search asks for the full cap, filters to the perimeter, then honours k', async () => {
  let askedFor: number | undefined
  const hits = [
    { path: 'deals/a.md', title: 'A', score: 3, kind: 'note' as const, snippet: 'aa' },
    { path: 'salaries/pay.md', title: 'Pay', score: 2, kind: 'note' as const, snippet: 'bb' },
    { path: 'deals/b.md', title: 'B', score: 1, kind: 'note' as const, snippet: 'cc' },
  ]
  const response = await handleBridgeCall(
    target({ perimeter: perimeter({ read: ['deals/**'] }) }),
    'context.search',
    { query: 'pay', k: 1 },
    deps({
      searchContext: async (_p, _c, _q, _f, k) => {
        askedFor = k
        return { hits, semantic: 'no-key', plan: PLAN }
      },
    }),
  )
  assert.equal(askedFor, BRIDGE_LIMITS.maxRows)
  assert.deepEqual(valueOf(response), [{ path: 'deals/a.md', title: 'A', snippet: 'aa', score: 3 }])
})

// ── grants, not the perimeter ─────────────────────────────────────────────────

test('a note the viewer cannot see is not_found, not forbidden', async () => {
  const error = errorOf(
    await handleBridgeCall(
      target({ perimeter: perimeter({ read: ['**'] }) }),
      'context.read',
      { path: 'salaries/pay.md' },
      deps({ readVisible: async () => null }),
    ),
  )
  assert.equal(error.code, 'not_found')
})

test("a write the viewer's grants refuse is forbidden, and says so in the gate's words", async () => {
  const error = errorOf(
    await handleBridgeCall(
      target({ perimeter: perimeter({ write: ['deals/**'] }) }),
      'context.write',
      { path: 'deals/acme.md', content: '# Acme' },
      deps({ writeGated: async () => ({ status: 'denied', reason: 'You have view access in "deals".' }) }),
    ),
  )
  assert.equal(error.code, 'forbidden')
  assert.equal(error.message, 'You have view access in "deals".')
})

test('a write that lands returns its stored path and is audited as the tool', async () => {
  const audits: Array<{ path: string; detail?: string }> = []
  const response = await handleBridgeCall(
    target({ perimeter: perimeter({ write: ['deals/**'] }) }),
    'context.write',
    { path: 'deals/acme.md', content: '# Acme' },
    deps({
      writeGated: async (_p, _c, path) => ({ status: 'applied', path }),
      logAudit: async (_spaceId, entry) => {
        audits.push(entry)
      },
    }),
  )
  assert.deepEqual(valueOf(response), { path: 'deals/acme.md' })
  assert.equal(audits.length, 1)
  assert.match(audits[0].detail ?? '', /tool:deals write/)
})

test('append goes through the log gate, not a whole-note write', async () => {
  let calls = 0
  const response = await handleBridgeCall(
    target({ perimeter: perimeter({ write: ['deals/**'] }) }),
    'context.append',
    { path: 'deals/acme.md', text: 'Called them back' },
    deps({
      appendLogGated: async (_p, _c, path) => {
        calls++
        return { status: 'applied', path }
      },
    }),
  )
  assert.deepEqual(valueOf(response), { path: 'deals/acme.md' })
  assert.equal(calls, 1)
})

// ── degraded installs ─────────────────────────────────────────────────────────

test('a connector the space lacks is degraded, not a perimeter failure', async () => {
  const t = target({
    perimeter: perimeter({ connectors: ['hubspot'] }),
    degraded: { missing: { connectors: ['hubspot'], types: [], agents: [] } },
  })
  const error = errorOf(await handleBridgeCall(t, 'connectors.call', { name: 'hubspot', code: 'return 1' }, deps()))
  assert.equal(error.code, 'degraded')
})

// ── agents ────────────────────────────────────────────────────────────────────

test('agents.run returns the run id without waiting for the run', async () => {
  const t = target({ perimeter: perimeter({ agents: ['nightly'] }) })
  let dispatched = false
  const response = await handleBridgeCall(t, 'agents.run', { name: 'nightly' }, deps({
    canTriggerRun: async () => true,
    claimManualRun: async () => ({
      ok: true,
      runId: 'run-9',
      dispatch: new Promise((resolve) => {
        dispatched = true
        setTimeout(() => resolve({ ok: true, outcome: 'done' } as never), 5)
      }),
    }),
  }))
  assert.deepEqual(valueOf(response), { runId: 'run-9' })
  assert.equal(dispatched, true)
})

test('an inactive agent is forbidden and a busy one is rate_limited', async () => {
  const t = target({ perimeter: perimeter({ agents: ['nightly'] }) })
  const base = {
    canTriggerRun: async () => true,
  }
  const inactive = errorOf(
    await handleBridgeCall(t, 'agents.run', { name: 'nightly' }, deps({
      ...base,
      claimManualRun: async () => ({ ok: false, code: 'inactive', message: 'must be active' }),
    })),
  )
  assert.equal(inactive.code, 'forbidden')

  const busy = errorOf(
    await handleBridgeCall(t, 'agents.run', { name: 'nightly' }, deps({
      ...base,
      claimManualRun: async () => ({ ok: false, code: 'busy', message: 'already running' }),
    })),
  )
  assert.equal(busy.code, 'rate_limited')
})

// ── state ─────────────────────────────────────────────────────────────────────

test('preview state round-trips in memory and is scoped to the tool', async () => {
  const stateDeps = deps({ getToolState, setToolState })
  const preview = target({ installId: null, install: { preview: true, name: 'deals' } })
  const other = target({
    installId: null,
    install: { preview: true, name: 'other' },
    config: { ...preview.config, name: 'other' },
  })

  assert.equal(valueOf(await handleBridgeCall(preview, 'state.get', { key: 'sort' }, stateDeps)), null)
  await handleBridgeCall(preview, 'state.set', { key: 'sort', value: { by: 'title' } }, stateDeps)
  assert.deepEqual(valueOf(await handleBridgeCall(preview, 'state.get', { key: 'sort' }, stateDeps)), { by: 'title' })
  assert.equal(
    valueOf(await handleBridgeCall(other, 'state.get', { key: 'sort' }, stateDeps)),
    null,
    'another tool must not read this one’s state',
  )

  await handleBridgeCall(preview, 'state.set', { key: 'sort', value: null }, stateDeps)
  assert.equal(valueOf(await handleBridgeCall(preview, 'state.get', { key: 'sort' }, stateDeps)), null)
})

test('a state value over STATE_MAX_BYTES (64KB) is refused', async () => {
  const preview = target({ installId: null, install: { preview: true, name: 'deals' } })
  const error = errorOf(
    await handleBridgeCall(
      preview,
      'state.set',
      { key: 'blob', value: 'x'.repeat(STATE_MAX_BYTES) },
      deps({ getToolState, setToolState }),
    ),
  )
  assert.equal(error.code, 'too_large')
})

/**
 * A minimal stand-in for the install path's row-count cap — real installs are
 * backed by `prisma.appToolState`, which these unit tests never touch, but the
 * refuse-vs-overwrite-vs-clear shape is exactly what `setToolState` enforces
 * against that table. This proves the bridge wires a `key_limit` refusal
 * through correctly, the same way the byte-cap test above proves `too_large`
 * does for values.
 */
function fakeInstallState(seedKeys: number) {
  const store = new Map<string, unknown>()
  for (let i = 0; i < seedKeys; i++) store.set(`seed-${i}`, i)
  return {
    store,
    getToolState: async (_t: ResolvedTarget, key: string) => store.get(key) ?? null,
    setToolState: async (_t: ResolvedTarget, key: string, value: unknown): Promise<StateSetResult> => {
      if (value === null || value === undefined) {
        store.delete(key)
        return { ok: true }
      }
      if (!store.has(key) && store.size >= STATE_MAX_KEYS) return { ok: false, reason: 'key_limit' }
      store.set(key, value)
      return { ok: true }
    },
  }
}

test('a new key past the install cap refuses', async () => {
  const fake = fakeInstallState(STATE_MAX_KEYS)
  const error = errorOf(
    await handleBridgeCall(target(), 'state.set', { key: 'one-too-many', value: 1 }, deps(fake)),
  )
  assert.equal(error.code, 'too_large')
  assert.match(error.message, new RegExp(String(STATE_MAX_KEYS)))
  assert.equal(fake.store.has('one-too-many'), false)
})

test('overwriting an existing key still writes at the install cap', async () => {
  const fake = fakeInstallState(STATE_MAX_KEYS)
  const result = valueOf(
    await handleBridgeCall(target(), 'state.set', { key: 'seed-0', value: 'updated' }, deps(fake)),
  )
  assert.equal(result, null)
  assert.equal(fake.store.get('seed-0'), 'updated')
})

test('clearing a key at the install cap frees a slot for a new one', async () => {
  const fake = fakeInstallState(STATE_MAX_KEYS)
  await handleBridgeCall(target(), 'state.set', { key: 'seed-0', value: null }, deps(fake))
  assert.equal(fake.store.size, STATE_MAX_KEYS - 1)

  const result = valueOf(
    await handleBridgeCall(target(), 'state.set', { key: 'brand-new', value: 'x' }, deps(fake)),
  )
  assert.equal(result, null)
  assert.equal(fake.store.get('brand-new'), 'x')
})

// ── the rest of the envelope ──────────────────────────────────────────────────

test('subject.get answers null when the host supplied no subject', async () => {
  assert.equal(valueOf(await handleBridgeCall(target(), 'subject.get', {}, deps())), null)
})

test('bad params are invalid, and name the field', async () => {
  const t = target({ perimeter: perimeter({ read: ['**'] }) })
  const error = errorOf(await handleBridgeCall(t, 'context.read', { path: 42 }, deps()))
  assert.equal(error.code, 'invalid')
  assert.match(error.message, /path/)
})

test('a dependency that throws becomes internal, never an exception', async () => {
  const original = console.error
  console.error = () => {}
  try {
    const error = errorOf(
      await handleBridgeCall(
        target({ perimeter: perimeter({ read: ['**'] }) }),
        'context.read',
        { path: 'deals/acme.md' },
        deps({
          readVisible: async () => {
            throw new Error('connection terminated: host=db-prod-1')
          },
        }),
      ),
    )
    assert.equal(error.code, 'internal')
    assert.doesNotMatch(error.message, /db-prod-1/, 'the real error must stay in the server log')
  } finally {
    console.error = original
  }
})

// ── data.js, on a real isolate ────────────────────────────────────────────────

test('a data.js handler runs, sees its args and reaches an injected capability', async () => {
  const t = target({
    perimeter: perimeter({ read: ['deals/**'] }),
    dataBundle: `handlers.summary = async (args, visvine) => {
      const note = await visvine.context.read(args.path)
      return { title: note.content.trim(), doubled: args.n * 2, tool: install.slug, hasFetch: typeof fetch !== 'undefined' }
    }`,
  })
  const response = await runDataHandler(t, 'summary', { path: 'deals/acme.md', n: 21 }, {
    capabilities: {
      'context.read': async (args) => ({ path: args[0], content: '# Acme', frontmatter: {} }),
    },
  })
  assert.deepEqual(valueOf(response), { title: '# Acme', doubled: 42, tool: 'deals', hasFetch: false })
})

test('an undeclared read from data.js is refused in the perimeter’s own words', async () => {
  const t = target({
    perimeter: perimeter({ read: ['deals/**'] }),
    dataBundle: `handlers.peek = async (args, visvine) => await visvine.context.read('salaries/pay.md')`,
  })
  // The real bridge handlers, closed over the target — exactly what data.call
  // installs. `readVisible` is a trap, so reaching it fails the test.
  const response = await runDataHandler(t, 'peek', null, {
    capabilities: bridgeCapabilities(t, deps()),
  })
  const error = errorOf(response)
  assert.equal(error.code, 'perimeter')
  assert.match(error.message, /salaries\/pay\.md is not in this tool's read globs/)
})

test('calling a handler data.js never defined is not_found', async () => {
  const t = target({ dataBundle: `handlers.summary = async () => 1` })
  const error = errorOf(await runDataHandler(t, 'missing', null, {}))
  assert.equal(error.code, 'not_found')
})

test('a tool with no data.js says so rather than failing obscurely', async () => {
  const error = errorOf(await runDataHandler(target(), 'summary', null, {}))
  assert.equal(error.code, 'not_found')
  assert.match(error.message, /no data\.js/)
})

test('a handler that throws is the author’s error, reported verbatim', async () => {
  const t = target({ dataBundle: `handlers.boom = async () => { throw new Error('deals is empty') }` })
  const error = errorOf(await runDataHandler(t, 'boom', null, {}))
  assert.equal(error.code, 'invalid')
  assert.match(error.message, /deals is empty/)
})

// ── resolveBridgeTarget: the `tools` feature key ──────────────────────────────
//
// `tools` is a real feature key (lib/featureAccess.ts) an admin can switch off
// for a space. These prove resolveBridgeTarget asks that question itself — for
// BOTH target kinds — rather than leaving it to a caller, and that it runs
// before the read that a disabled space has no business making (readVisible is
// a trap here, the same way the UNDECLARED perimeter tests above trap every
// dep a refused call must never reach).

const SESSION: SessionPayload = { userId: 'user-1', name: 'Viewer', email: 'viewer@local.dev' }

function resolvedContext(over: Partial<ResolvedContext> = {}): ResolvedContext {
  return {
    spaceId: 'space-1',
    ownerKey: 'shared',
    scope: 'shared',
    isAdmin: false,
    isPersonalSpace: false,
    actor: { id: 'user-1', name: 'Viewer', email: 'viewer@local.dev' },
    ...over,
  }
}

const INSTALL_ROW = {
  id: 'install-1',
  spaceId: 'space-1',
  slug: 'deals',
  key: 'space-1/deals',
  enabled: true,
  requirements: {},
  version: { name: 'deals', title: 'Deals', config: { title: 'Deals' }, perimeter: {}, dataBundle: '' },
}

function principalFor(resolved: ResolvedContext): ContextPrincipal {
  return {
    userId: resolved.actor.id,
    email: resolved.actor.email ?? '',
    name: resolved.actor.name,
    spaceId: resolved.spaceId,
    spaceAdmin: resolved.isAdmin,
    access: OPEN_ACCESS,
  }
}

/** Every dependency, wired to fail the test if the gate lets a call through. */
function targetDeps(over: Partial<TargetDeps> = {}): TargetDeps {
  const forbidden = (name: string) => () => {
    throw new Error(`${name} was called — the gate should have refused first`)
  }
  const base = {
    findInstall: forbidden('findInstall'),
    findBuild: forbidden('findBuild'),
    resolveContext: forbidden('resolveContext'),
    principalOf: forbidden('principalOf'),
    readVisible: forbidden('readVisible'),
    featureAccessForbidden: forbidden('featureAccessForbidden'),
  }
  return { ...(base as unknown as TargetDeps), ...over }
}

/** The error on a resolveBridgeTarget result the test expects to have refused. */
function targetErrorOf(response: ResolvedTarget | BridgeError): BridgeError {
  assert.ok('code' in response, `expected a refusal, got ${JSON.stringify(response)}`)
  return response as BridgeError
}

test('an install is refused when the directory is not available to the caller', async () => {
  const error = targetErrorOf(
    await resolveBridgeTarget(
      SESSION,
      { kind: 'install', installId: 'install-1' },
      targetDeps({
        findInstall: async () => INSTALL_ROW,
        resolveContext: async () => resolvedContext(),
        featureAccessForbidden: async () => true,
      }),
    ),
  )
  assert.equal(error.code, 'forbidden')
  // A Tool is a node of the directory, so that is the gate — there is no tools key.
  assert.match(error.message, /Tools are not available to you in this space/)
})

test('a preview is refused when the directory is not available, before the note is even read', async () => {
  const error = targetErrorOf(
    await resolveBridgeTarget(
      SESSION,
      { kind: 'preview', spaceId: 'space-1', name: 'deals' },
      targetDeps({
        resolveContext: async () => resolvedContext(),
        featureAccessForbidden: async () => true,
      }),
    ),
  )
  assert.equal(error.code, 'forbidden')
})

test('an admin of a directory-private space is still allowed (featureAccessForbidden exempts admins)', async () => {
  const resolved = resolvedContext({ isAdmin: true })
  const response = await resolveBridgeTarget(
    SESSION,
    { kind: 'install', installId: 'install-1' },
    targetDeps({
      findInstall: async () => INSTALL_ROW,
      resolveContext: async () => resolved,
      principalOf: async (r) => principalFor(r),
      // The real featureAccessForbidden already returns false for an admin even
      // when the space toggle is off (lib/auth.ts) — asserted here as the
      // contract resolveBridgeTarget relies on, not re-derived.
      featureAccessForbidden: async () => false,
    }),
  )
  assert.equal('code' in response, false, `expected success, got ${JSON.stringify(response)}`)
  const t = response as ResolvedTarget
  assert.equal(t.isAdmin, true)
  assert.equal(t.installId, 'install-1')
})

test('a preview author who is an admin of a tools-disabled space is still allowed', async () => {
  const resolved = resolvedContext({ isAdmin: true })
  const response = await resolveBridgeTarget(
    SESSION,
    { kind: 'preview', spaceId: 'space-1', name: 'deals' },
    targetDeps({
      resolveContext: async () => resolved,
      principalOf: async (r) => principalFor(r),
      featureAccessForbidden: async () => false,
      readVisible: async () => `---\ntype: tool\ntitle: Deals\n---\n`,
      findBuild: async () => null,
    }),
  )
  assert.equal('code' in response, false, `expected success, got ${JSON.stringify(response)}`)
  const t = response as ResolvedTarget
  assert.equal(t.isAdmin, true)
  assert.equal(t.installId, null)
})

// ── paging ────────────────────────────────────────────────────────────────────

test('context.list without a cursor still answers a plain array (backwards compatible)', async () => {
  const metas = [note('deals/a.md'), note('deals/b.md')]
  const response = await handleBridgeCall(
    target({ perimeter: perimeter({ read: ['deals/**'] }) }),
    'context.list',
    {},
    deps({ visibleVault: async () => ({ raws: [], metas }) }),
  )
  assert.equal(Array.isArray(valueOf(response)), true)
})

test('context.list pages by path with an opaque cursor, and the last page has nextCursor null', async () => {
  const metas = [
    ...Array.from({ length: BRIDGE_LIMITS.maxRows + 50 }, (_, i) => note(`deals/${String(i).padStart(4, '0')}.md`)),
    note('salaries/pay.md'),
  ]
  const t = target({ perimeter: perimeter({ read: ['deals/**'] }) })
  const d = deps({ visibleVault: async () => ({ raws: [], metas }) })

  const first = valueOf(await handleBridgeCall(t, 'context.list', { page: true }, d)) as {
    items: Array<{ path: string }>
    nextCursor: string | null
  }
  assert.equal(first.items.length, BRIDGE_LIMITS.maxRows)
  assert.equal(typeof first.nextCursor, 'string')
  assert.equal(first.items[0].path, 'deals/0000.md')

  const second = valueOf(await handleBridgeCall(t, 'context.list', { cursor: first.nextCursor! }, d)) as {
    items: Array<{ path: string }>
    nextCursor: string | null
  }
  assert.equal(second.items.length, 50)
  assert.equal(second.items[0].path, `deals/${String(BRIDGE_LIMITS.maxRows).padStart(4, '0')}.md`)
  assert.equal(second.nextCursor, null)
  // No overlap, nothing skipped, nothing outside the perimeter.
  const all = [...first.items, ...second.items].map((r) => r.path)
  assert.equal(new Set(all).size, BRIDGE_LIMITS.maxRows + 50)
  assert.equal(all.every((p) => p.startsWith('deals/')), true)
})

test('an exact page boundary reports no next page rather than an empty one', async () => {
  const metas = Array.from({ length: BRIDGE_LIMITS.maxRows }, (_, i) => note(`deals/${String(i).padStart(4, '0')}.md`))
  const t = target({ perimeter: perimeter({ read: ['deals/**'] }) })
  const first = valueOf(
    await handleBridgeCall(t, 'context.list', { page: true }, deps({ visibleVault: async () => ({ raws: [], metas }) })),
  ) as { items: unknown[]; nextCursor: string | null }
  assert.equal(first.items.length, BRIDGE_LIMITS.maxRows)
  assert.equal(first.nextCursor, null)
})

test('a forged cursor is refused as invalid', async () => {
  const error = errorOf(
    await handleBridgeCall(
      target({ perimeter: perimeter({ read: ['deals/**'] }) }),
      'context.list',
      { cursor: 'not base64url!!' },
      deps({ visibleVault: async () => ({ raws: [], metas: [] }) }),
    ),
  )
  assert.equal(error.code, 'invalid')
})

test('context.search pages by rank: k is the page size and the cursor is the offset', async () => {
  const hits = Array.from({ length: 7 }, (_, i) => ({
    path: `deals/${i}.md`,
    title: `D${i}`,
    score: 10 - i,
    kind: 'note' as const,
    snippet: '',
  }))
  const t = target({ perimeter: perimeter({ read: ['deals/**'] }) })
  const d = deps({ searchContext: async () => ({ hits, semantic: 'no-key', plan: PLAN }) })

  const first = valueOf(await handleBridgeCall(t, 'context.search', { query: 'd', k: 3, page: true }, d)) as {
    items: Array<{ path: string }>
    nextCursor: string | null
  }
  assert.deepEqual(first.items.map((h) => h.path), ['deals/0.md', 'deals/1.md', 'deals/2.md'])
  assert.equal(typeof first.nextCursor, 'string')

  const second = valueOf(
    await handleBridgeCall(t, 'context.search', { query: 'd', k: 3, cursor: first.nextCursor! }, d),
  ) as { items: Array<{ path: string }>; nextCursor: string | null }
  assert.deepEqual(second.items.map((h) => h.path), ['deals/3.md', 'deals/4.md', 'deals/5.md'])

  const third = valueOf(
    await handleBridgeCall(t, 'context.search', { query: 'd', k: 3, cursor: second.nextCursor! }, d),
  ) as { items: Array<{ path: string }>; nextCursor: string | null }
  assert.deepEqual(third.items.map((h) => h.path), ['deals/6.md'])
  assert.equal(third.nextCursor, null)

  // Unpaged is unchanged: a plain array, first k.
  const plain = valueOf(await handleBridgeCall(t, 'context.search', { query: 'd', k: 2 }, d)) as unknown[]
  assert.equal(Array.isArray(plain) && plain.length === 2, true)
})

test('the isolate capabilities pass a cursor through positionally', async () => {
  const metas = Array.from({ length: BRIDGE_LIMITS.maxRows + 1 }, (_, i) => note(`deals/${String(i).padStart(4, '0')}.md`))
  const caps = bridgeCapabilities(
    target({ perimeter: perimeter({ read: ['deals/**'] }) }),
    deps({ visibleVault: async () => ({ raws: [], metas }) }),
  )
  const plain = (await caps['context.list']([undefined])) as unknown[]
  assert.equal(Array.isArray(plain), true)
  // A cursor makes it paged: after the last path of an unpaged first page.
  const lastPath = (plain[plain.length - 1] as { path: string }).path
  const cursor = Buffer.from(lastPath, 'utf8').toString('base64url')
  const paged = (await caps['context.list'](['deals/**', cursor])) as { items: unknown[]; nextCursor: string | null }
  assert.equal(paged.items.length, 1)
  assert.equal(paged.nextCursor, null)
})
