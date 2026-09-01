/**
 * The Tool bridge protocol (lib/tools/protocol.ts). The guards are a trust
 * boundary — the host reads frame messages with them and the server reads the
 * host's — so the cases that matter are the malformed ones.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-protocol.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BRIDGE_LIMITS,
  BRIDGE_METHODS,
  PROTOCOL_VERSION,
  isBridgeMethod,
  isFrameMessage,
  isHostMessage,
  isInAppPath,
  type BridgeMethod,
  type HostMessage,
  type ToolInitMessage,
} from '@/lib/tools/protocol'

const INIT: ToolInitMessage = {
  type: 'visvine:init',
  version: PROTOCOL_VERSION,
  theme: { '--color-brand-green': '#78d870' },
  subject: null,
  install: { slug: 'deals', title: 'Deal Pipeline', key: 'tool:deals' },
  degraded: null,
  viewer: { id: 'user_1', name: 'Ada', isAdmin: false },
}

// ── methods ──

test('BRIDGE_METHODS lists every method exactly once', () => {
  // The object literal must be exhaustive or this file does not compile, so the
  // comparison pins the runtime list to the type.
  const everyMethod: Record<BridgeMethod, true> = {
    'context.list': true,
    'context.read': true,
    'context.search': true,
    'context.write': true,
    'context.append': true,
    'connectors.call': true,
    'agents.run': true,
    'data.call': true,
    'state.get': true,
    'state.set': true,
    'subject.get': true,
  }
  assert.deepEqual([...BRIDGE_METHODS].sort(), Object.keys(everyMethod).sort())
  assert.equal(new Set(BRIDGE_METHODS).size, BRIDGE_METHODS.length)
})

test('isBridgeMethod refuses anything not on the list', () => {
  assert.ok(isBridgeMethod('context.read'))
  for (const bad of ['context.delete', 'Context.read', '', 'toString', null, 7, {}]) {
    assert.equal(isBridgeMethod(bad), false, String(bad))
  }
})

// ── host → frame ──

test('isHostMessage accepts the five host messages', () => {
  const messages: HostMessage[] = [
    INIT,
    { ...INIT, subject: { kind: 'note', path: 'deals/acme.md', type: 'deal', title: 'Acme' } },
    { ...INIT, subject: { kind: 'node', nodeId: 'person:ada', type: 'person', notePath: null } },
    { ...INIT, install: { preview: true, name: 'deals' } },
    { ...INIT, degraded: { missing: { connectors: ['hubspot'], types: [], agents: [] } } },
    { type: 'visvine:result', id: 'c1', ok: true, value: { path: 'deals/acme.md' } },
    { type: 'visvine:result', id: 'c1', ok: false, error: { code: 'perimeter', message: 'not declared' } },
    { type: 'visvine:theme', theme: {} },
    { type: 'visvine:subject', subject: null },
    { type: 'visvine:changed', paths: [] },
    { type: 'visvine:changed', paths: ['deals/acme.md', 'deals/other.md'] },
  ]
  for (const m of messages) assert.ok(isHostMessage(m), JSON.stringify(m))
})

test('isHostMessage rejects malformed host messages', () => {
  const bad: unknown[] = [
    null,
    'visvine:init',
    [INIT],
    { type: 'visvine:unknown' },
    { ...INIT, theme: { '--x': 3 } },
    { ...INIT, viewer: { id: 'u', name: 'Ada' } },
    { ...INIT, install: { slug: 'deals', title: 'Deals' } },
    { ...INIT, install: { preview: true } },
    { ...INIT, degraded: { missing: { connectors: 'hubspot', types: [], agents: [] } } },
    { ...INIT, subject: { kind: 'note', path: 'deals/acme.md' } },
    { ...INIT, subject: { kind: 'folder', path: 'deals' } },
    // ok:true carries a value key even when the value is undefined; a result
    // with neither value nor error is a bug on the host side, not "undefined".
    { type: 'visvine:result', id: 'c1', ok: true },
    { type: 'visvine:result', id: 'c1', ok: false, error: { code: 'nope', message: 'x' } },
    { type: 'visvine:result', id: 1, ok: true, value: null },
    { type: 'visvine:theme', theme: null },
    { type: 'visvine:changed' },
    { type: 'visvine:changed', paths: 'deals/acme.md' },
    { type: 'visvine:changed', paths: [1] },
  ]
  for (const m of bad) assert.equal(isHostMessage(m), false, JSON.stringify(m))
})

test('a result with an explicit undefined value still reads as ok', () => {
  assert.ok(isHostMessage({ type: 'visvine:result', id: 'c1', ok: true, value: undefined }))
})

// ── frame → host ──

test('isFrameMessage accepts the five frame messages', () => {
  const messages: unknown[] = [
    { type: 'visvine:ready', version: PROTOCOL_VERSION },
    { type: 'visvine:call', id: 'c1', method: 'context.list', params: { glob: 'deals/**' } },
    { type: 'visvine:call', id: 'c1', method: 'subject.get', params: {} },
    { type: 'visvine:resize', height: 0 },
    { type: 'visvine:resize', height: 812 },
    { type: 'visvine:error', message: 'boom' },
    { type: 'visvine:error', message: 'boom', stack: 'at Tool' },
    { type: 'visvine:navigate', path: '/directory/note/deals/acme.md' },
  ]
  for (const m of messages) assert.ok(isFrameMessage(m), JSON.stringify(m))
})

test('isFrameMessage rejects malformed frame messages', () => {
  const bad: unknown[] = [
    null,
    { type: 'visvine:ready' },
    { type: 'visvine:call', id: 'c1', method: 'context.list' },
    { type: 'visvine:call', id: 'c1', method: 'context.destroy', params: {} },
    { type: 'visvine:call', method: 'context.list', params: {} },
    { type: 'visvine:resize', height: -1 },
    { type: 'visvine:resize', height: Number.NaN },
    { type: 'visvine:resize', height: Number.POSITIVE_INFINITY },
    { type: 'visvine:resize', height: '812' },
    { type: 'visvine:error', message: 42 },
    { type: 'visvine:error', message: 'boom', stack: 42 },
    { type: 'visvine:navigate', path: null },
  ]
  for (const m of bad) assert.equal(isFrameMessage(m), false, JSON.stringify(m))
})

// ── navigate ──

test('isInAppPath only allows same-origin absolute paths', () => {
  for (const ok of ['/', '/tools', '/t/deals', '/directory/note/deals/acme.md', '/directory?type=event']) {
    assert.ok(isInAppPath(ok), ok)
  }
  for (const bad of [
    '',
    'tools',
    '//evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    '/\\evil.example',
    '/\tevil',
  ]) {
    assert.equal(isInAppPath(bad), false, JSON.stringify(bad))
  }
})

// ── limits ──

test('BRIDGE_LIMITS are the numbers the SDK documents', () => {
  assert.deepEqual(BRIDGE_LIMITS, {
    maxRows: 200,
    maxReadBytes: 256_000,
    maxWriteBytes: 128_000,
    maxParamsBytes: 64_000,
    callsPerMinute: 120,
    dataCallTimeoutMs: 20_000,
  })
  // A write that would not survive a read back is a trap for authors.
  assert.ok(BRIDGE_LIMITS.maxWriteBytes <= BRIDGE_LIMITS.maxReadBytes)
})
