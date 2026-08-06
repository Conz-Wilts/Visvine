/**
 * The isolate boundary's value layer: structural copying with caps, and
 * secret redaction that walks data instead of round-tripping text.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { marshalValue, redactDeep, MARSHAL_LIMITS } from '@/lib/connectors/marshal'

// ── marshalValue ──

test('marshalValue round-trips the JSON types', () => {
  for (const v of [null, true, false, 0, -1, 3.5, '', 'hello', [], {}]) {
    assert.deepEqual(marshalValue(v), v)
  }
  assert.deepEqual(marshalValue({ a: [1, { b: 'c' }], d: null }), { a: [1, { b: 'c' }], d: null })
})

test('marshalValue drops what JSON cannot carry', () => {
  assert.deepEqual(marshalValue({ fn: () => 1, sym: Symbol('s'), und: undefined, keep: 1 }), { keep: 1 })
  // In an array the position has to hold, so the same values become null.
  assert.deepEqual(marshalValue([1, undefined, () => 1, 2]), [1, null, null, 2])
})

test('marshalValue normalises numbers, bigints and dates', () => {
  assert.equal(marshalValue(NaN), null)
  assert.equal(marshalValue(Infinity), null)
  assert.equal(marshalValue(-Infinity), null)
  assert.equal(marshalValue(BigInt(10)), '10')
  assert.equal(marshalValue(new Date('2026-08-06T00:00:00.000Z')), '2026-08-06T00:00:00.000Z')
  assert.equal(marshalValue(new Date('nope')), null)
})

test('marshalValue survives a cycle instead of hanging', () => {
  const a: Record<string, unknown> = { name: 'a' }
  a.self = a
  const report = { truncated: false }
  const out = marshalValue(a, report) as Record<string, unknown>
  assert.equal(out.name, 'a')
  assert.equal(out.self, '[truncated]')
  assert.equal(report.truncated, true)
})

test('marshalValue keeps sibling references, which are not cycles', () => {
  const shared = { n: 1 }
  assert.deepEqual(marshalValue({ x: shared, y: shared }), { x: { n: 1 }, y: { n: 1 } })
})

test('marshalValue caps depth, node count and string length', () => {
  let deep: unknown = 'bottom'
  for (let i = 0; i < 200; i++) deep = { next: deep }
  const depthReport = { truncated: false }
  marshalValue(deep, depthReport)
  assert.equal(depthReport.truncated, true)

  const bigString = 'x'.repeat(MARSHAL_LIMITS.maxStringChars + 100)
  const stringReport = { truncated: false }
  const cut = marshalValue(bigString, stringReport) as string
  assert.equal(cut.length, MARSHAL_LIMITS.maxStringChars)
  assert.equal(stringReport.truncated, true)

  const wide = Array.from({ length: MARSHAL_LIMITS.maxNodes + 10 }, (_, i) => i)
  const nodeReport = { truncated: false }
  marshalValue(wide, nodeReport)
  assert.equal(nodeReport.truncated, true)
})

// ── redactDeep ──

test('redactDeep replaces secrets at every depth', () => {
  const out = redactDeep({ a: [{ b: 'Bearer sk_live_123' }], c: 'clean' }, ['sk_live_123'])
  assert.deepEqual(out, { a: [{ b: 'Bearer [redacted]' }], c: 'clean' })
})

test('redactDeep preserves types — only strings are touched', () => {
  const out = redactDeep({ n: 12345, t: true, z: null, s: '12345' }, ['12345'])
  assert.deepEqual(out, { n: 12345, t: true, z: null, s: '[redacted]' })
})

test('redactDeep redacts object keys too', () => {
  assert.deepEqual(redactDeep({ sk_live_123: 'v' }, ['sk_live_123']), { '[redacted]': 'v' })
})

test('redactDeep handles a secret ending in a backslash', () => {
  // The v1 approach — JSON.parse(redactSecrets(JSON.stringify(x))) — throws on
  // this input, because the escaped copy of the trailing backslash survives
  // redaction and escapes the closing quote. Walking the structure cannot.
  const secret = 'pa$$\\'
  assert.deepEqual(redactDeep({ token: secret }, [secret]), { token: '[redacted]' })
  assert.deepEqual(redactDeep({ token: `x${secret}y` }, [secret]), { token: 'x[redacted]y' })
})

test('redactDeep is a no-op with no secrets, and tolerates an empty value', () => {
  const input = { a: 'b' }
  assert.equal(redactDeep(input, []), input)
  assert.deepEqual(redactDeep({ a: 'b' }, ['']), { a: 'b' })
})
