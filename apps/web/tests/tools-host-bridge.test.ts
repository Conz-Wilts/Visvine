/**
 * The host half of the Tool bridge (features/tools/lib/hostBridge.ts) and the
 * theme it hands across (features/tools/lib/theme.ts), against fake windows.
 *
 * Everything here is a boundary test. The frame is third-party code on an opaque
 * origin, so the questions are: does a message from anywhere but that exact
 * window get dropped, can a Tool make the host throw, can it grow past the pane,
 * can it steer the app off-site, and can it make the host re-send the handshake.
 * The relay itself is exercised through an injected `send` — the server's own
 * behaviour belongs to the bridge route's tests, not here.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-host-bridge.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { FetchJsonError } from '@/lib/fetchJson'
import {
  MIN_FRAME_HEIGHT,
  SANDBOXED_FRAME_ORIGIN,
  createHostBridge,
  type FrameMessageEvent,
  type HostBridgeOptions,
  type HostInit,
} from '@/features/tools/lib/hostBridge'
import { collectThemeTokens, themeTokensFrom } from '@/features/tools/lib/theme'
import { PROTOCOL_VERSION, type BridgeRequest, type BridgeTarget } from '@/lib/tools/protocol'

const TARGET: BridgeTarget = { kind: 'install', installId: 'inst_1' }

const INIT: HostInit = {
  theme: { '--vv-accent': '#60a5fa' },
  subject: { kind: 'note', path: 'deals/acme/index.md', type: 'deal', title: 'Acme' },
  install: { slug: 'deals', title: 'Deal Pipeline', key: 'tool:deals' },
  degraded: null,
  viewer: { id: 'u1', name: 'Ada', isAdmin: true },
}

/** The window inside the iframe: records everything the host posts at it. */
class FakeFrameWindow {
  posted: Array<{ message: unknown; targetOrigin: string }> = []

  postMessage(message: unknown, targetOrigin: string): void {
    this.posted.push({ message, targetOrigin })
  }

  /** The posted messages, as the frame's own `event.data` would see them. */
  get messages(): Array<Record<string, unknown>> {
    return this.posted.map((entry) => entry.message as Record<string, unknown>)
  }

  types(): string[] {
    return this.messages.map((message) => String(message.type))
  }
}

/** The page's window: lets a test deliver a `message` event by hand. */
class FakeHostWindow {
  listeners = new Set<(event: FrameMessageEvent) => void>()

  addEventListener(_type: 'message', listener: (event: FrameMessageEvent) => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'message', listener: (event: FrameMessageEvent) => void): void {
    this.listeners.delete(listener)
  }

  deliver(event: FrameMessageEvent): void {
    this.listeners.forEach((listener) => listener(event))
  }
}

interface Harness {
  frame: FakeFrameWindow
  host: FakeHostWindow
  bridge: ReturnType<typeof createHostBridge>
  sent: BridgeRequest[]
  events: { ready: number; resize: number[]; errors: Array<{ message: string; stack?: string }>; navigated: string[] }
  /** Post a frame message from the real frame window at the expected origin. */
  fromFrame(data: unknown): void
}

function harness(overrides: Partial<HostBridgeOptions> = {}): Harness {
  const frame = new FakeFrameWindow()
  const host = new FakeHostWindow()
  const sent: BridgeRequest[] = []
  const events: Harness['events'] = { ready: 0, resize: [], errors: [], navigated: [] }

  const bridge = createHostBridge({
    iframe: { contentWindow: frame },
    hostWindow: host,
    frameOrigin: SANDBOXED_FRAME_ORIGIN,
    target: TARGET,
    init: () => INIT,
    maxHeight: () => 900,
    onReady: () => {
      events.ready += 1
    },
    onResize: (height) => events.resize.push(height),
    onError: (error) => events.errors.push(error),
    navigate: (path) => events.navigated.push(path),
    send: async (request) => {
      sent.push(request)
      return { ok: true, value: { rows: 1 } }
    },
    ...overrides,
  })

  return {
    frame,
    host,
    bridge,
    sent,
    events,
    fromFrame: (data) => host.deliver({ data, origin: SANDBOXED_FRAME_ORIGIN, source: frame }),
  }
}

const READY = { type: 'visvine:ready', version: PROTOCOL_VERSION }

/** Lets queued relay promises settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

// ── handshake ──

test('ready is answered with the init payload, once', () => {
  const h = harness()
  h.fromFrame(READY)

  assert.equal(h.frame.posted.length, 1)
  assert.deepEqual(h.frame.messages[0], {
    type: 'visvine:init',
    version: PROTOCOL_VERSION,
    theme: INIT.theme,
    subject: INIT.subject,
    install: INIT.install,
    degraded: INIT.degraded,
    viewer: INIT.viewer,
    section: null,
  })
  assert.equal(h.events.ready, 1)

  // A Tool re-posting `ready` must not be able to make the host repeat itself.
  h.fromFrame(READY)
  assert.equal(h.frame.posted.length, 1)
  assert.equal(h.events.ready, 1)
})

test('the init payload is built at ready time, not at construction', () => {
  let accent = '#78d870'
  const h = harness({ init: () => ({ ...INIT, theme: { '--vv-accent': accent } }) })
  accent = '#f472b6'
  h.fromFrame(READY)
  assert.deepEqual(h.frame.messages[0].theme, { '--vv-accent': '#f472b6' })
})

test('a sandboxed frame is addressed with "*", a real origin with itself', () => {
  const sandboxed = harness()
  sandboxed.fromFrame(READY)
  assert.equal(
    sandboxed.frame.posted[0].targetOrigin,
    '*',
    'an opaque origin matches no serialized origin, so nothing else can reach it',
  )

  const named = harness({ frameOrigin: 'https://tools.visvine.com' })
  named.host.deliver({ data: READY, origin: 'https://tools.visvine.com', source: named.frame })
  assert.equal(named.frame.posted[0].targetOrigin, 'https://tools.visvine.com')
})

// ── who is allowed to speak ──

test('a message from the wrong origin is ignored', () => {
  const h = harness()
  h.host.deliver({ data: READY, origin: 'https://evil.example', source: h.frame })
  assert.equal(h.frame.posted.length, 0)
  assert.equal(h.events.ready, 0)
})

test('a message from another window at the right origin is ignored', () => {
  const h = harness()
  const impostor = new FakeFrameWindow()
  h.host.deliver({ data: READY, origin: SANDBOXED_FRAME_ORIGIN, source: impostor })
  assert.equal(h.frame.posted.length, 0)
  assert.equal(h.events.ready, 0)
})

test('malformed messages are dropped rather than read', () => {
  const h = harness()
  for (const data of [
    null,
    'visvine:ready',
    ['visvine:ready'],
    { type: 'visvine:ready' }, // no version
    { type: 'visvine:call', id: 1, method: 'context.list', params: {} }, // id not a string
    { type: 'visvine:call', id: 'c1', method: 'context.nuke', params: {} }, // unknown method
    { type: 'visvine:call', id: 'c1', method: 'context.list' }, // no params key
    { type: 'visvine:resize', height: 'tall' },
    { type: 'visvine:resize', height: Number.NaN },
    { type: 'visvine:navigate' },
    { type: 'visvine:something-else' },
  ]) {
    h.fromFrame(data)
  }
  assert.equal(h.frame.posted.length, 0)
  assert.equal(h.sent.length, 0)
  assert.equal(h.events.resize.length, 0)
  assert.equal(h.events.navigated.length, 0)
})

// ── relay ──

test('a call is relayed with the host\'s target and answered with a result', async () => {
  const h = harness()
  h.fromFrame(READY)
  h.fromFrame({ type: 'visvine:call', id: 'c1', method: 'context.list', params: { glob: 'deals/**' } })
  await flush()

  assert.deepEqual(h.sent, [{ target: TARGET, method: 'context.list', params: { glob: 'deals/**' } }])
  assert.deepEqual(h.frame.messages[1], {
    type: 'visvine:result',
    id: 'c1',
    ok: true,
    value: { rows: 1 },
  })
})

test('a frame cannot name its own target', async () => {
  const h = harness()
  h.fromFrame({
    type: 'visvine:call',
    id: 'c1',
    method: 'context.read',
    params: { path: 'x.md' },
    // A Tool trying to smuggle a target into the message it controls.
    target: { kind: 'install', installId: 'someone-elses-install' },
  })
  await flush()
  assert.deepEqual(h.sent[0].target, TARGET)
})

test('an HTTP failure becomes a result the Tool can read, never a throw', async () => {
  const cases: Array<[number, string]> = [
    [400, 'invalid'],
    [401, 'forbidden'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [408, 'timeout'],
    [413, 'too_large'],
    [429, 'rate_limited'],
    [504, 'timeout'],
    [500, 'internal'],
  ]
  for (const [status, code] of cases) {
    const h = harness({
      send: async () => {
        throw new FetchJsonError(status, 'the server said no')
      },
    })
    h.fromFrame({ type: 'visvine:call', id: 'c1', method: 'context.read', params: { path: 'x.md' } })
    await flush()
    assert.deepEqual(
      h.frame.messages[0],
      { type: 'visvine:result', id: 'c1', ok: false, error: { code, message: 'the server said no' } },
      `status ${status}`,
    )
  }
})

test('a network failure becomes an internal error result', async () => {
  const h = harness({
    send: async () => {
      throw new TypeError('Failed to fetch')
    },
  })
  h.fromFrame({ type: 'visvine:call', id: 'c9', method: 'data.call', params: { fn: 'load', args: {} } })
  await flush()
  assert.deepEqual(h.frame.messages[0], {
    type: 'visvine:result',
    id: 'c9',
    ok: false,
    error: { code: 'internal', message: 'Visvine could not reach the Tool bridge.' },
  })
})

test('an unreadable bridge answer is not passed through as a result', async () => {
  for (const body of [null, 'ok', { ok: 'yes' }, { ok: false }, { ok: false, error: { code: 'perimeter' } }]) {
    const h = harness({ send: async () => body })
    h.fromFrame({ type: 'visvine:call', id: 'c1', method: 'state.get', params: { key: 'k' } })
    await flush()
    const message = h.frame.messages[0] as { ok: boolean; error: { code: string } }
    assert.equal(message.ok, false, JSON.stringify(body))
    assert.equal(message.error.code, 'internal')
  }
})

test('a refusal the server did shape is passed through verbatim', async () => {
  const error = { code: 'perimeter', message: 'This Tool did not declare deals/**' }
  const h = harness({ send: async () => ({ ok: false, error }) })
  h.fromFrame({ type: 'visvine:call', id: 'c1', method: 'context.read', params: { path: 'x.md' } })
  await flush()
  assert.deepEqual(h.frame.messages[0], { type: 'visvine:result', id: 'c1', ok: false, error })
})

test('a result that lands after dispose is not posted', async () => {
  let release: (value: unknown) => void = () => {}
  const h = harness({ send: () => new Promise((resolve) => (release = resolve)) })
  h.fromFrame({ type: 'visvine:call', id: 'c1', method: 'context.list', params: {} })
  h.bridge.dispose()
  release({ ok: true, value: [] })
  await flush()
  assert.equal(h.frame.posted.length, 0)
})

// ── resize ──

test('resize is clamped to the pane and never below the floor', () => {
  const h = harness()
  h.fromFrame({ type: 'visvine:resize', height: 10 })
  h.fromFrame({ type: 'visvine:resize', height: 0 })
  h.fromFrame({ type: 'visvine:resize', height: 5000 })
  h.fromFrame({ type: 'visvine:resize', height: 640.2 })
  assert.deepEqual(h.events.resize, [MIN_FRAME_HEIGHT, MIN_FRAME_HEIGHT, 900, 641])
})

test('the ceiling is read live, so a shrinking pane shrinks the frame', () => {
  let pane = 900
  const h = harness({ maxHeight: () => pane })
  h.fromFrame({ type: 'visvine:resize', height: 5000 })
  pane = 500
  h.fromFrame({ type: 'visvine:resize', height: 5000 })
  assert.deepEqual(h.events.resize, [900, 500])
})

test('a pane shorter than the floor still gets the floor', () => {
  const h = harness({ maxHeight: () => 100 })
  h.fromFrame({ type: 'visvine:resize', height: 5000 })
  assert.deepEqual(h.events.resize, [MIN_FRAME_HEIGHT])
})

// ── navigation ──

test('only in-app paths are routed', () => {
  const h = harness()
  const allowed = ['/tools', '/directory/tool:deals', '/directory/note/deals/acme/index.md?tab=raw']
  const refused = [
    '//evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    '\\\\evil.example',
    'tools',
    '/\tevil',
  ]
  for (const path of [...allowed, ...refused]) {
    h.fromFrame({ type: 'visvine:navigate', path })
  }
  assert.deepEqual(h.events.navigated, allowed)
})

// ── errors ──

test('a frame error is surfaced with its stack', () => {
  const h = harness()
  h.fromFrame({ type: 'visvine:error', message: 'Cannot read x of undefined', stack: 'at Tool (ui.tsx:4)' })
  h.fromFrame({ type: 'visvine:error', message: 'second' })
  assert.deepEqual(h.events.errors, [
    { message: 'Cannot read x of undefined', stack: 'at Tool (ui.tsx:4)' },
    { message: 'second', stack: undefined },
  ])
})

// ── pushes ──

test('theme is pushed only after the handshake, and only when it changed', () => {
  const h = harness()
  h.bridge.setTheme({ '--vv-accent': '#f472b6' })
  assert.equal(h.frame.posted.length, 0, 'nothing is posted before the frame is listening')

  h.fromFrame(READY)
  assert.deepEqual(h.frame.types(), ['visvine:init'])

  // init reset the remembered theme to what was actually sent, so the same map
  // is a no-op and a different one is a push.
  h.bridge.setTheme({ ...INIT.theme })
  assert.deepEqual(h.frame.types(), ['visvine:init'])

  h.bridge.setTheme({ '--vv-accent': '#f472b6' })
  assert.deepEqual(h.frame.types(), ['visvine:init', 'visvine:theme'])
  assert.deepEqual(h.frame.messages[1].theme, { '--vv-accent': '#f472b6' })

  // Same values, different key count.
  h.bridge.setTheme({ '--vv-accent': '#f472b6', '--vv-text': '#111827' })
  assert.equal(h.frame.posted.length, 3)
})

test('subject is pushed only when it changed, including to null', () => {
  const h = harness()
  h.fromFrame(READY)

  h.bridge.setSubject({ ...INIT.subject } as HostInit['subject'])
  assert.deepEqual(h.frame.types(), ['visvine:init'])

  h.bridge.setSubject(null)
  h.bridge.setSubject(null)
  assert.deepEqual(h.frame.types(), ['visvine:init', 'visvine:subject'])
  assert.equal(h.frame.messages[1].subject, null)

  h.bridge.setSubject({ kind: 'node', nodeId: 'deal:acme', type: 'deal', notePath: null })
  assert.deepEqual(h.frame.types(), ['visvine:init', 'visvine:subject', 'visvine:subject'])
})

test('changed paths are relayed only after the handshake, and never empty', () => {
  const h = harness()
  h.bridge.notifyChanged(['deals/acme.md'])
  assert.equal(h.frame.posted.length, 0, 'a Tool that has not started has nothing to refresh')

  h.fromFrame(READY)
  h.bridge.notifyChanged([])
  assert.deepEqual(h.frame.types(), ['visvine:init'])

  h.bridge.notifyChanged(['deals/acme.md', 'deals/other.md'])
  assert.deepEqual(h.frame.types(), ['visvine:init', 'visvine:changed'])
  assert.deepEqual(h.frame.messages[1].paths, ['deals/acme.md', 'deals/other.md'])

  h.bridge.dispose()
  h.bridge.notifyChanged(['deals/acme.md'])
  assert.equal(h.frame.posted.length, 2)
})

// ── teardown ──

test('dispose unhooks the listener and silences the bridge', () => {
  const h = harness()
  h.fromFrame(READY)
  h.bridge.dispose()
  assert.equal(h.host.listeners.size, 0)

  h.fromFrame({ type: 'visvine:resize', height: 500 })
  h.bridge.setTheme({ '--vv-accent': '#000000' })
  assert.equal(h.events.resize.length, 0)
  assert.equal(h.frame.posted.length, 1, 'still just the init from before')

  h.bridge.dispose() // idempotent
})

test('a frame that has already gone is not posted to', () => {
  const frame = new FakeFrameWindow()
  const host = new FakeHostWindow()
  let contentWindow: FakeFrameWindow | null = frame
  const bridge = createHostBridge({
    iframe: {
      get contentWindow() {
        return contentWindow
      },
    },
    hostWindow: host,
    frameOrigin: SANDBOXED_FRAME_ORIGIN,
    target: TARGET,
    init: () => INIT,
    maxHeight: () => 900,
    onReady: () => {},
    onResize: () => {},
    onError: () => {},
    navigate: () => {},
    send: async () => ({ ok: true, value: null }),
  })

  host.deliver({ data: READY, origin: SANDBOXED_FRAME_ORIGIN, source: frame })
  contentWindow = null
  // The window it came from is gone; the message names a source that can no
  // longer match, so nothing is read and nothing is posted.
  host.deliver({ data: READY, origin: SANDBOXED_FRAME_ORIGIN, source: frame })
  assert.equal(frame.posted.length, 1)
  bridge.dispose()
})

// ── theme collection ──

test('theme tokens are read from the design tokens and published under the legacy name and the vv alias', () => {
  const painted: Record<string, string> = {
    '--vv-color-accent': '#60a5fa',
    '--vv-color-accent-strong': '#1d4ed8',
    '--vv-color-fg-muted': '  #808080  ',
  }
  const tokens = themeTokensFrom((name) => painted[name] ?? '')

  assert.equal(tokens['--color-brand-green'], '#60a5fa')
  assert.equal(tokens['--vv-accent'], '#60a5fa', 'the kit stylesheet paints from the alias')
  assert.equal(tokens['--vv-accent-strong'], '#1d4ed8')
  assert.equal(tokens['--vv-text-muted'], '#808080', 'values are trimmed')
  assert.equal(tokens['--text-muted'], '#808080')
})

test('an unpainted token falls back rather than shipping empty', () => {
  const tokens = themeTokensFrom(() => '')
  assert.equal(tokens['--vv-accent'], '#78d870', 'the default Visvine green')
  assert.equal(tokens['--vv-surface'], '#ffffff')
  assert.ok(tokens['--vv-font'].includes('Open Sauce One'))
  assert.ok(
    Object.values(tokens).every((value) => value.trim().length > 0),
    'a Tool given an empty custom property paints nothing at all',
  )
  // Whitespace-only counts as unpainted too.
  assert.equal(themeTokensFrom(() => '   ')['--vv-accent'], '#78d870')
})

test('every published token has both halves and none is the brand marketing face', () => {
  const tokens = themeTokensFrom(() => '')
  // The design tokens themselves go too, for kit 2's components; the rest pair up.
  const designTokens = Object.keys(tokens).filter((name) => name.startsWith('--vv-color-'))
  const aliases = Object.keys(tokens).filter((name) => name.startsWith('--vv-') && !name.startsWith('--vv-color-'))
  const sources = Object.keys(tokens).filter((name) => !name.startsWith('--vv-'))
  assert.equal(aliases.length, sources.length)
  assert.ok(designTokens.includes('--vv-color-accent'))
  assert.ok(!('--font-brand' in tokens), 'ABC Ginto Rounded is marketing-only')
})

test('collectThemeTokens reads :root first, then body', () => {
  const style = (values: Record<string, string>) => ({
    getPropertyValue: (name: string) => values[name] ?? '',
  })
  const doc = {
    documentElement: { tag: 'html' },
    body: { tag: 'body' },
    defaultView: {
      getComputedStyle: (element: { tag: string }) =>
        element.tag === 'html'
          ? style({ '--vv-color-accent': '#111111' })
          : style({ '--vv-color-accent': '#222222', '--vv-color-fg': '#333333' }),
    },
  } as unknown as Document

  const tokens = collectThemeTokens(doc)
  assert.equal(tokens['--vv-accent'], '#111111', ':root wins')
  assert.equal(tokens['--vv-text'], '#333333', 'body fills what :root left unset')
})

test('collectThemeTokens on a detached document falls back rather than throwing', () => {
  const tokens = collectThemeTokens({ defaultView: null } as unknown as Document)
  assert.equal(tokens['--vv-accent'], '#78d870')
})

// ── pulled back ──

test('a `revoked` answer goes to the host, never to the Tool', async () => {
  const revoked: string[] = []
  const h = harness({
    send: async () => ({ ok: false, error: { code: 'revoked', message: 'Suspended by Visvine' } }),
    onRevoked: (message) => revoked.push(message),
  })
  h.fromFrame(READY)
  h.fromFrame({ type: 'visvine:call', id: 'c1', method: 'context.read', params: { path: 'deals/a.md' } })
  await flush()
  assert.deepEqual(revoked, ['Suspended by Visvine'])
  assert.deepEqual(h.frame.types(), ['visvine:init'], 'the Tool is told nothing — the host removes it')
})

test('every other refusal still reaches the Tool as its result', async () => {
  const revoked: string[] = []
  const h = harness({
    send: async () => ({ ok: false, error: { code: 'perimeter', message: 'not declared' } }),
    onRevoked: (message) => revoked.push(message),
  })
  h.fromFrame(READY)
  h.fromFrame({ type: 'visvine:call', id: 'c1', method: 'context.read', params: { path: 'x.md' } })
  await flush()
  assert.deepEqual(revoked, [])
  assert.deepEqual(h.frame.types(), ['visvine:init', 'visvine:result'])
})

// ── sections and band buttons ──

test('the active section rides the handshake, and a change is posted as a route', () => {
  const h = harness({ init: () => ({ ...INIT, section: 'board' }) })
  h.fromFrame(READY)
  assert.equal((h.frame.messages[0] as { section?: string }).section, 'board')
  h.bridge.setSection('board')
  h.bridge.setSection('forecast')
  assert.deepEqual(h.frame.messages.slice(1), [{ type: 'visvine:route', section: 'forecast' }])
})

test('a band button press reaches the frame only after the handshake', () => {
  const h = harness()
  h.bridge.sendAction('new-deal')
  assert.equal(h.frame.posted.length, 0)
  h.fromFrame(READY)
  h.bridge.sendAction('new-deal')
  assert.deepEqual(h.frame.messages[1], { type: 'visvine:action', id: 'new-deal' })
})

test("a Tool's request for a section goes to the page, which decides", () => {
  const asked: string[] = []
  const h = harness({ onSection: (section) => asked.push(section) })
  h.fromFrame(READY)
  h.fromFrame({ type: 'visvine:section', section: 'forecast' })
  h.fromFrame({ type: 'visvine:section', section: 42 })
  assert.deepEqual(asked, ['forecast'])
})
