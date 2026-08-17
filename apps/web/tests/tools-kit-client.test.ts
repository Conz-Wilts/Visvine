/**
 * The in-frame bridge client (features/tools/kit/client.ts) against a fake
 * window: correlation, timeouts, and the origin check that is the frame's only
 * trust boundary.
 *
 * The client ships inside the sandbox bundle and so may not import app code —
 * this file is where the constants it restates get pinned to the originals.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-kit-client.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BridgeCallError,
  CALL_TIMEOUT_MS,
  DATA_CALL_TIMEOUT_MS,
  PROTOCOL_VERSION as KIT_PROTOCOL_VERSION,
  createBridgeClient,
} from '@/features/tools/kit/client'
import { BRIDGE_LIMITS, PROTOCOL_VERSION, type ToolInitMessage } from '@/lib/tools/protocol'

const PARENT = 'https://visvine.com'
const OTHER = 'https://evil.example'

const INIT: ToolInitMessage = {
  type: 'visvine:init',
  version: PROTOCOL_VERSION,
  theme: { '--color-brand-green': '#60a5fa' },
  subject: null,
  install: { slug: 'deals', title: 'Deal Pipeline', key: 'tool:deals' },
  degraded: null,
  viewer: { id: 'user_1', name: 'Ada', isAdmin: true },
}

/** Just enough Window for the client: a parent to post to and a message hose. */
class FakeWindow {
  readonly sent: Array<{ message: unknown; targetOrigin: string }> = []
  readonly listeners = new Set<(event: MessageEvent) => void>()
  readonly parent = {
    postMessage: (message: unknown, targetOrigin: string) => {
      this.sent.push({ message, targetOrigin })
    },
  }

  addEventListener(_type: string, fn: (event: MessageEvent) => void): void {
    this.listeners.add(fn)
  }

  removeEventListener(_type: string, fn: (event: MessageEvent) => void): void {
    this.listeners.delete(fn)
  }

  deliver(data: unknown, origin: string = PARENT): void {
    for (const fn of [...this.listeners]) fn({ data, origin } as MessageEvent)
  }

  get last(): Record<string, unknown> {
    return this.sent[this.sent.length - 1].message as Record<string, unknown>
  }
}

function clientFor(win: FakeWindow, parentOrigin = PARENT) {
  return createBridgeClient(win as unknown as Window, parentOrigin)
}

/** Resolved/rejected/still-waiting, after letting the microtask queue drain. */
async function stateOf(p: Promise<unknown>): Promise<'pending' | 'resolved' | 'rejected'> {
  let state: 'pending' | 'resolved' | 'rejected' = 'pending'
  p.then(
    () => {
      state = 'resolved'
    },
    () => {
      state = 'rejected'
    },
  )
  for (let i = 0; i < 4; i++) await Promise.resolve()
  return state
}

// ── the constants the bundle restates ──

test('the kit speaks the protocol version it was built against', () => {
  assert.equal(KIT_PROTOCOL_VERSION, PROTOCOL_VERSION)
})

test('the frame waits longer for data.call than the server does', () => {
  assert.ok(
    DATA_CALL_TIMEOUT_MS > BRIDGE_LIMITS.dataCallTimeoutMs,
    'the server timeout must fire first so its error — which names the handler — wins',
  )
})

// ── posting ──

test('ready and the notifications post to the parent at the exact origin', () => {
  const win = new FakeWindow()
  const client = clientFor(win)

  client.ready()
  assert.deepEqual(win.last, { type: 'visvine:ready', version: KIT_PROTOCOL_VERSION })
  assert.equal(win.sent[0].targetOrigin, PARENT)

  client.reportError('boom')
  assert.deepEqual(win.last, { type: 'visvine:error', message: 'boom' })
  client.reportError('boom', 'at Tool')
  assert.deepEqual(win.last, { type: 'visvine:error', message: 'boom', stack: 'at Tool' })

  client.navigate('/t/deals')
  assert.deepEqual(win.last, { type: 'visvine:navigate', path: '/t/deals' })

  client.close()
})

test('resize rounds up and drops heights that cannot be laid out', () => {
  const win = new FakeWindow()
  const client = clientFor(win)

  client.resize(412.2)
  assert.deepEqual(win.last, { type: 'visvine:resize', height: 413 })

  const before = win.sent.length
  client.resize(-1)
  client.resize(Number.NaN)
  client.resize(Number.POSITIVE_INFINITY)
  assert.equal(win.sent.length, before)

  client.close()
})

test('nothing is posted after close', () => {
  const win = new FakeWindow()
  const client = clientFor(win)
  client.close()
  client.ready()
  client.resize(100)
  assert.equal(win.sent.length, 0)
  assert.equal(win.listeners.size, 0, 'close drops the message listener')
})

// ── correlation ──

test('concurrent calls are correlated by id, whatever order they come back in', async () => {
  const win = new FakeWindow()
  const client = clientFor(win)

  const read = client.call('context.read', { path: 'deals/acme.md' })
  const list = client.call('context.list', { glob: 'deals/**' })

  const [readCall, listCall] = win.sent.map((s) => s.message as { id: string; method: string })
  assert.equal(readCall.method, 'context.read')
  assert.equal(listCall.method, 'context.list')
  assert.notEqual(readCall.id, listCall.id)

  win.deliver({ type: 'visvine:result', id: listCall.id, ok: true, value: [] })
  win.deliver({
    type: 'visvine:result',
    id: readCall.id,
    ok: true,
    value: { path: 'deals/acme.md', content: '# Acme', frontmatter: {} },
  })

  assert.deepEqual(await list, [])
  assert.equal((await read).content, '# Acme')
  client.close()
})

test('a result for an unknown id is ignored rather than settling something else', async () => {
  const win = new FakeWindow()
  const client = clientFor(win)
  const pending = client.call('subject.get', {})

  win.deliver({ type: 'visvine:result', id: 'not-a-call', ok: true, value: null })
  assert.equal(await stateOf(pending), 'pending')

  client.close()
  assert.equal(await stateOf(pending), 'rejected')
})

test('a refusal rejects with the server code intact', async () => {
  const win = new FakeWindow()
  const client = clientFor(win)
  const pending = client.call('context.write', { path: 'secrets/keys.md', content: 'x' })
  const { id } = win.last as unknown as { id: string }

  win.deliver({
    type: 'visvine:result',
    id,
    ok: false,
    error: { code: 'perimeter', message: 'secrets/keys.md is not in this Tool’s write perimeter' },
  })

  await assert.rejects(pending, (e: unknown) => {
    assert.ok(e instanceof BridgeCallError)
    assert.equal(e.code, 'perimeter')
    assert.match(e.message, /write perimeter/)
    return true
  })
  client.close()
})

test('a malformed refusal still rejects, as an internal error', async () => {
  const win = new FakeWindow()
  const client = clientFor(win)
  const pending = client.call('subject.get', {})
  const { id } = win.last as unknown as { id: string }

  win.deliver({ type: 'visvine:result', id, ok: false })

  await assert.rejects(pending, (e: unknown) => e instanceof BridgeCallError && e.code === 'internal')
  client.close()
})

// ── origin ──

test('a message from another origin is ignored entirely', async () => {
  const win = new FakeWindow()
  const client = clientFor(win)
  let inits = 0
  client.onInit(() => {
    inits += 1
  })

  const pending = client.call('subject.get', {})
  const { id } = win.last as unknown as { id: string }

  win.deliver(INIT, OTHER)
  win.deliver({ type: 'visvine:result', id, ok: true, value: null }, OTHER)
  win.deliver({ type: 'visvine:theme', theme: { '--color-brand-green': '#f00' } }, OTHER)

  assert.equal(inits, 0, 'a foreign origin cannot hand the Tool a viewer')
  assert.equal(await stateOf(pending), 'pending')

  // …and the same messages from the real parent do land.
  win.deliver(INIT)
  win.deliver({ type: 'visvine:result', id, ok: true, value: null })
  assert.equal(inits, 1)
  assert.equal(await stateOf(pending), 'resolved')

  client.close()
})

// ── subscriptions ──

test('onInit replays the handshake to a late subscriber, once', () => {
  const win = new FakeWindow()
  const client = clientFor(win)
  win.deliver(INIT)

  const seen: ToolInitMessage[] = []
  const off = client.onInit((init) => seen.push(init))
  assert.equal(seen.length, 1)
  assert.equal(seen[0].viewer.name, 'Ada')

  off()
  win.deliver({ ...INIT, viewer: { id: 'user_2', name: 'Grace', isAdmin: false } })
  assert.equal(seen.length, 1, 'unsubscribing stops delivery')

  client.close()
})

test('theme and subject updates reach their subscribers', () => {
  const win = new FakeWindow()
  const client = clientFor(win)
  const themes: Array<Record<string, string>> = []
  const subjects: unknown[] = []
  client.onTheme((t) => themes.push(t))
  client.onSubject((s) => subjects.push(s))

  win.deliver({ type: 'visvine:theme', theme: { '--color-brand-green': '#a78bfa' } })
  win.deliver({ type: 'visvine:subject', subject: { kind: 'note', path: 'deals/acme.md', type: 'deal', title: 'Acme' } })
  win.deliver({ type: 'visvine:subject', subject: null })

  assert.deepEqual(themes, [{ '--color-brand-green': '#a78bfa' }])
  assert.deepEqual(subjects, [{ kind: 'note', path: 'deals/acme.md', type: 'deal', title: 'Acme' }, null])

  client.close()
})

// ── timeouts ──

/** Runs `fn` with `setTimeout` captured rather than scheduled, and returns what it caught. */
async function withCapturedTimers(fn: (fire: (index: number) => void) => Promise<void>) {
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  const scheduled: Array<{ fn: () => void; ms: number }> = []
  globalThis.setTimeout = ((cb: () => void, ms: number) => {
    scheduled.push({ fn: cb, ms })
    return scheduled.length as unknown as ReturnType<typeof setTimeout>
  }) as unknown as typeof globalThis.setTimeout
  globalThis.clearTimeout = (() => undefined) as unknown as typeof globalThis.clearTimeout
  try {
    await fn((index) => scheduled[index].fn())
    return scheduled
  } finally {
    globalThis.setTimeout = realSetTimeout
    globalThis.clearTimeout = realClearTimeout
  }
}

test('a call nobody answers rejects as a timeout, on a clock that fits the method', async () => {
  const scheduled = await withCapturedTimers(async (fire) => {
    const win = new FakeWindow()
    const client = clientFor(win)

    const ordinary = client.call('context.list', {})
    const data = client.call('data.call', { fn: 'summary', args: null })

    fire(0)
    await assert.rejects(ordinary, (e: unknown) => {
      assert.ok(e instanceof BridgeCallError)
      assert.equal(e.code, 'timeout')
      assert.match(e.message, /context\.list/)
      return true
    })

    fire(1)
    await assert.rejects(data, (e: unknown) => e instanceof BridgeCallError && e.code === 'timeout')

    client.close()
  })

  assert.equal(scheduled[0].ms, CALL_TIMEOUT_MS)
  assert.equal(scheduled[1].ms, DATA_CALL_TIMEOUT_MS, 'data.call gets the longer clock')
})
