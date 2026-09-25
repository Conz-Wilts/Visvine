/**
 * A Tool's collections: the schema subset, the read/write rules, the query
 * and row limits, and the bridge's order — a Tool asking for a collection it
 * never declared, or a viewer the rules keep out, is refused before any row
 * is read.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-collections.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { transform } from 'esbuild'
import { parse } from 'acorn'
import { rowDenial, schemaDenial } from '@visvine/tool-protocol/schema'
import { factsFromPerimeter, parseManifestFacts, type CollectionSpec } from '@visvine/tool-protocol/manifest'
import {
  collectionChangePath,
  collectionDenial,
  decodeCursor,
  encodeCursor,
  MAX_ROW_BYTES,
  queryDenial,
  readsOwnOnly,
  rowSizeDenial,
} from '@/lib/tools/shared/collections'
import { handleBridgeCall, type BridgeDeps } from '@/lib/tools/bridge'
import type { ResolvedTarget } from '@/lib/tools/target'
import { EMPTY_PERIMETER } from '@/lib/tools/perimeter'
import type { BridgeResponse } from '@/lib/tools/protocol'
import { OPEN_ACCESS } from '@/lib/notes/shared/authz'
import { scanCode } from '@/lib/tools/checks/codeRules'
import { positionLookup } from '@/lib/tools/checks/sourceMap'
import { declaredVsUsed } from '@/lib/tools/checks/usage'

const VOTE_SCHEMA = {
  type: 'object',
  properties: { choice: { type: 'string', enum: ['a', 'b', 'c'] }, weight: { type: 'integer', minimum: 1, maximum: 5 } },
  required: ['choice'],
  additionalProperties: false,
}

function spec(over: Partial<CollectionSpec> = {}): CollectionSpec {
  return { schema: VOTE_SCHEMA, read: 'all', write: 'own', maxRows: 10_000, ...over }
}

// ── the schema ───────────────────────────────────────────────────────────────

test('a collection schema is an object schema in the supported subset', () => {
  assert.equal(schemaDenial(VOTE_SCHEMA), null)
  assert.match(schemaDenial({ type: 'string' }) ?? '', /type: object/)
  assert.match(schemaDenial({ properties: {} }) ?? '', /type: object/)
  assert.match(schemaDenial({ type: 'object', properties: { code: { type: 'string', pattern: '^(a+)+$' } } }) ?? '', /"pattern"/)
  assert.match(schemaDenial({ type: 'object', $ref: '#/x' }) ?? '', /"\$ref"/)
  assert.match(schemaDenial({ type: 'object', properties: { x: { type: 'date' } } }) ?? '', /unknown type/)
  assert.match(schemaDenial({ type: 'object', required: 'choice' }) ?? '', /required/)
  assert.match(schemaDenial({ type: 'object', additionalProperties: { type: 'string' } }) ?? '', /true or false/)
  assert.match(schemaDenial({ type: 'object', properties: { n: { type: 'number', minimum: '1' } } }) ?? '', /minimum/)
  let deep: Record<string, unknown> = { type: 'string' }
  for (let i = 0; i < 8; i++) deep = { type: 'object', properties: { x: deep } }
  assert.match(schemaDenial(deep) ?? '', /too deep/)
})

test('a row is held to its schema, naming where it fails', () => {
  assert.equal(rowDenial(VOTE_SCHEMA, { choice: 'a' }), null)
  assert.equal(rowDenial(VOTE_SCHEMA, { choice: 'b', weight: 3 }), null)
  assert.match(rowDenial(VOTE_SCHEMA, {}) ?? '', /row\.choice is required/)
  assert.match(rowDenial(VOTE_SCHEMA, { choice: 'z' }) ?? '', /row\.choice must be one of/)
  assert.match(rowDenial(VOTE_SCHEMA, { choice: 'a', weight: 2.5 }) ?? '', /row\.weight must be integer/)
  assert.match(rowDenial(VOTE_SCHEMA, { choice: 'a', weight: 9 }) ?? '', /at most 5/)
  assert.match(rowDenial(VOTE_SCHEMA, { choice: 'a', voter: 'ada' }) ?? '', /row\.voter is not in the schema/)
  const list = { type: 'object', properties: { tags: { type: 'array', items: { type: 'string', maxLength: 3 }, maxItems: 2 } } }
  assert.equal(rowDenial(list, { tags: ['x', 'yy'] }), null)
  assert.match(rowDenial(list, { tags: ['x', 'y', 'z'] }) ?? '', /at most 2 items/)
  assert.match(rowDenial(list, { tags: ['long'] }) ?? '', /row\.tags\[0\] is longer than 3/)
  assert.equal(rowDenial({ type: 'object', properties: { n: { type: 'number' } } }, { n: 4 }), null, 'an integer is a number')
})

test('a manifest refuses a collection it cannot hold a Tool to, and caps maxRows', () => {
  const base = { sdk: '^2', permissions: {} }
  const refused = parseManifestFacts({ ...base, collections: { votes: { schema: { type: 'object', properties: { x: { type: 'string', pattern: 'a' } } } } } })
  assert.equal(refused.ok, false)
  assert.match(!refused.ok ? refused.error : '', /Collection "votes": .*"pattern"/)
  const bad = parseManifestFacts({ ...base, collections: { Votes: { schema: VOTE_SCHEMA } } })
  assert.equal(bad.ok, false)
  const ok = parseManifestFacts({ ...base, collections: { votes: { schema: VOTE_SCHEMA, read: 'own', maxRows: 1_000_000 } } })
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.deepEqual(ok.value.collections.votes, { schema: VOTE_SCHEMA, read: 'own', write: 'own', maxRows: 100_000 })
  }
  const defaulted = parseManifestFacts({ ...base, collections: { votes: { schema: VOTE_SCHEMA } } })
  assert.equal(defaulted.ok && defaulted.value.collections.votes.maxRows, 10_000)
})

// ── the rules ────────────────────────────────────────────────────────────────

test('an undeclared collection is the perimeter, not the viewer', () => {
  const refused = collectionDenial(undefined, 'votes', 'read', { isAdmin: true })
  assert.equal(refused?.code, 'perimeter')
  assert.match(refused?.message ?? '', /declares no collection "votes"/)
})

test('read: all | own | admin', () => {
  const member = { isAdmin: false }
  const admin = { isAdmin: true }
  assert.equal(collectionDenial(spec({ read: 'all' }), 'votes', 'read', member), null)
  assert.equal(collectionDenial(spec({ read: 'own' }), 'votes', 'read', member), null)
  assert.equal(readsOwnOnly(spec({ read: 'own' }), member), true)
  assert.equal(readsOwnOnly(spec({ read: 'own' }), admin), false, 'an admin reads every row')
  assert.equal(readsOwnOnly(spec({ read: 'all' }), member), false)
  assert.equal(collectionDenial(spec({ read: 'admin' }), 'votes', 'read', member)?.code, 'forbidden')
  assert.equal(collectionDenial(spec({ read: 'admin' }), 'votes', 'read', admin), null)
})

test('write: own lets anyone add and only the writer (or an admin) change a row', () => {
  const own = spec({ write: 'own' })
  const member = { isAdmin: false }
  assert.equal(collectionDenial(own, 'votes', 'insert', member), null)
  assert.equal(collectionDenial(own, 'votes', 'update', member, { mine: true }), null)
  assert.equal(collectionDenial(own, 'votes', 'delete', member, { mine: true }), null)
  assert.equal(collectionDenial(own, 'votes', 'update', member, { mine: false })?.code, 'forbidden')
  assert.equal(collectionDenial(own, 'votes', 'delete', member, { mine: false })?.code, 'forbidden')
  assert.equal(collectionDenial(own, 'votes', 'delete', { isAdmin: true }, { mine: false }), null)
})

test('write: all and write: admin', () => {
  assert.equal(collectionDenial(spec({ write: 'all' }), 'votes', 'update', { isAdmin: false }, { mine: false }), null)
  assert.equal(collectionDenial(spec({ write: 'admin' }), 'votes', 'insert', { isAdmin: false })?.code, 'forbidden')
  assert.equal(collectionDenial(spec({ write: 'admin' }), 'votes', 'insert', { isAdmin: true }), null)
})

test('a query names plain top-level fields, at most eight, matched against plain values', () => {
  assert.equal(queryDenial({ where: { choice: 'a', open: true, n: 2, gone: null }, groupBy: 'choice' }), null)
  assert.match(queryDenial({ where: { 'a.b': 1 } }) ?? '', /not a field name/)
  assert.match(queryDenial({ where: { "x'); DROP": 1 } }) ?? '', /not a field name/)
  assert.match(queryDenial({ groupBy: 'data->>x' }) ?? '', /not a field name/)
  assert.match(queryDenial({ where: { x: { $gt: 1 } } }) ?? '', /plain value/)
  const nine = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`f${i}`, i]))
  assert.match(queryDenial({ where: nine }) ?? '', /at most eight/)
})

test('a row is at most 16 KB', () => {
  assert.equal(rowSizeDenial({ text: 'x'.repeat(MAX_ROW_BYTES - 20) }), null)
  assert.match(rowSizeDenial({ text: 'x'.repeat(MAX_ROW_BYTES) }) ?? '', /at most 16 KB/)
})

test('a cursor round-trips and garbage reads as the first page', () => {
  const at = new Date('2026-09-20T10:00:00.000Z')
  assert.deepEqual(decodeCursor(encodeCursor({ createdAt: at, id: 'row-9' })), { createdAt: at, id: 'row-9' })
  assert.equal(decodeCursor(undefined), null)
  assert.equal(decodeCursor('not-a-cursor'), null)
  assert.equal(decodeCursor(Buffer.from('yesterday|x').toString('base64url')), null)
})

test('a collection write is announced under a path no note can have', () => {
  assert.equal(collectionChangePath('votes'), ':collection:votes')
})

// ── the bridge ───────────────────────────────────────────────────────────────

function target(collections: Record<string, CollectionSpec>, over: Partial<ResolvedTarget> = {}): ResolvedTarget {
  const manifest = { ...factsFromPerimeter(EMPTY_PERIMETER), collections }
  return {
    spaceId: 'space-1',
    principal: { userId: 'user-1', email: 'v@local.dev', name: 'V', spaceId: 'space-1', spaceAdmin: false, access: OPEN_ACCESS },
    context: { spaceId: 'space-1', ownerKey: 'shared' },
    perimeter: EMPTY_PERIMETER,
    config: {
      name: 'poll',
      title: 'Poll',
      description: '',
      version: 1,
      surfaces: { rail: null, types: [] },
      perimeter: EMPTY_PERIMETER,
      manifest,
      tags: [],
      previewUrl: null,
    },
    dataBundle: '',
    installId: 'install-1',
    degraded: null,
    install: { slug: 'poll', title: 'Poll', key: 'space-1/poll' },
    isAdmin: false,
    subject: null,
    ...over,
  }
}

/** Only the store; every one of its doors throws unless the test hands it one. */
function deps(collections: Partial<BridgeDeps['collections']> = {}): BridgeDeps {
  const trap = (name: string) => () => {
    throw new Error(`${name} was called — the gate should have refused first`)
  }
  const traps = Object.fromEntries(
    (['insert', 'list', 'get', 'update', 'delete', 'count'] as const).map((n) => [n, trap(`collections.${n}`)]),
  ) as unknown as BridgeDeps['collections']
  return { collections: { ...traps, ...collections }, logAudit: async () => {}, logResourceAccess: async () => {} } as unknown as BridgeDeps
}

function refusal(response: BridgeResponse): { code: string; message: string } {
  assert.equal(response.ok, false, `expected a refusal, got ${JSON.stringify(response).slice(0, 200)}`)
  return response.ok ? { code: '', message: '' } : response.error
}

test('the bridge refuses an undeclared collection before any row is touched', async () => {
  for (const [method, params] of [
    ['collections.insert', { collection: 'votes', data: { choice: 'a' } }],
    ['collections.list', { collection: 'votes' }],
    ['collections.count', { collection: 'votes', groupBy: 'choice' }],
    ['collections.delete', { collection: 'votes', id: 'r1' }],
  ] as const) {
    const error = refusal(await handleBridgeCall(target({ other: spec() }), method, params, deps()))
    assert.equal(error.code, 'perimeter', method)
  }
})

test('the bridge refuses a member an admin-only collection before any row is touched', async () => {
  const t = target({ votes: spec({ read: 'admin', write: 'admin' }) })
  assert.equal(refusal(await handleBridgeCall(t, 'collections.list', { collection: 'votes' }, deps())).code, 'forbidden')
  assert.equal(refusal(await handleBridgeCall(t, 'collections.insert', { collection: 'votes', data: { choice: 'a' } }, deps())).code, 'forbidden')
})

test('a declared collection reaches the store as the viewer, with its params checked', async () => {
  const seen: unknown[] = []
  const response = await handleBridgeCall(
    target({ votes: spec() }),
    'collections.count',
    { collection: 'votes', groupBy: 'choice', where: { open: true } },
    deps({
      count: async (t, name, query) => {
        seen.push(t.principal.userId, name, query.groupBy, query.where)
        return { ok: true, value: { total: 3, groups: [{ value: 'a', count: 3 }] } }
      },
    }),
  )
  assert.equal(response.ok, true)
  assert.deepEqual(seen, ['user-1', 'votes', 'choice', { open: true }])
  const bad = await handleBridgeCall(target({ votes: spec() }), 'collections.list', { collection: 'votes', limit: 5000 }, deps())
  assert.equal(refusal(bad).code, 'invalid')
  const nested = await handleBridgeCall(target({ votes: spec() }), 'collections.list', { collection: 'votes', where: { x: { gt: 1 } } }, deps())
  assert.equal(refusal(nested).code, 'invalid')
})

test('a store refusal comes back with its own code', async () => {
  const response = await handleBridgeCall(
    target({ votes: spec() }),
    'collections.update',
    { collection: 'votes', id: 'r1', data: { choice: 'b' } },
    deps({ update: async () => ({ ok: false, code: 'forbidden', message: 'You can change only the rows you wrote.' }) }),
  )
  assert.deepEqual(refusal(response), { code: 'forbidden', message: 'You can change only the rows you wrote.' })
})

// ── the checks ───────────────────────────────────────────────────────────────

async function scanUi(code: string) {
  const out = await transform(code, { loader: 'tsx', jsx: 'automatic', format: 'esm', sourcemap: 'external', sourcefile: 'ui.tsx' })
  const program = parse(out.code, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  return scanCode({ file: 'ui.tsx', program, locate: positionLookup(out.map) })
}

test('the checks see collection calls, through the API and the hooks', async () => {
  const scan = await scanUi(`
    import { useVisvine, useCollection, useCollectionCount } from '@visvine/tool-kit'
    export default function App() {
      const visvine = useVisvine()
      const rows = useCollection('votes', { mine: true })
      const tally = useCollectionCount('votes', { groupBy: 'choice' })
      return <button onClick={() => visvine.collections.insert('ballots', { choice: 'a' })}>Vote</button>
    }
  `)
  const methods = scan.calls.map((c) => `${c.method}:${c.arg}`)
  assert.ok(methods.includes('collections.list:votes'), methods.join(', '))
  assert.ok(methods.includes('collections.count:votes'))
  assert.ok(methods.includes('collections.insert:ballots'))
  const findings = declaredVsUsed(EMPTY_PERIMETER, scan.calls, null, ['votes', 'comments'])
  const undeclared = findings.find((f) => f.rule === 'usage.undeclared-collection')
  assert.match(undeclared?.message ?? '', /ballots/)
  const unused = findings.find((f) => f.rule === 'usage.unused-collection')
  assert.match(unused?.message ?? '', /comments/)
  assert.doesNotMatch(unused?.message ?? '', /votes/)
})

test('a collection named by a computed argument is not called unused', async () => {
  const scan = await scanUi(`
    import { useVisvine } from '@visvine/tool-kit'
    export default function App({ which }) {
      const visvine = useVisvine()
      return <button onClick={() => visvine.collections.insert(which, {})}>Add</button>
    }
  `)
  const findings = declaredVsUsed(EMPTY_PERIMETER, scan.calls, null, ['votes'])
  assert.equal(findings.find((f) => f.rule === 'usage.unused-collection'), undefined)
})
