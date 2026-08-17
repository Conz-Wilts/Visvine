/**
 * The Tool frame origin (lib/tools/origin.ts) and the frame's headers
 * (lib/tools/csp.ts): env parsing, the host split the proxy enforces, and the
 * two policies a Tool is served under.
 *
 * `toolsHostDecision` is the whole of proxy.ts's tools-host branch, extracted so
 * "the tools host must never serve the app" is a test rather than a comment.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-origin.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appOrigin,
  frameUrl,
  isToolRuntimePath,
  isToolsHost,
  toolsHostDecision,
  toolsOrigin,
  toolsOriginConfigured,
  TOOL_RUNTIME_PATH_PREFIX,
} from '@/lib/tools/origin'
import { bundleHeaders, frameCsp, frameHeaders } from '@/lib/tools/csp'
import nextConfig from '../next.config'

/** Runs `fn` with TOOLS_ORIGIN / NEXT_PUBLIC_APP_URL set, then restores both. */
function withEnv(env: { tools?: string; app?: string }, fn: () => void): void {
  const saved = { tools: process.env.TOOLS_ORIGIN, app: process.env.NEXT_PUBLIC_APP_URL }
  const apply = (key: 'TOOLS_ORIGIN' | 'NEXT_PUBLIC_APP_URL', value: string | undefined) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  apply('TOOLS_ORIGIN', env.tools)
  apply('NEXT_PUBLIC_APP_URL', env.app)
  try {
    fn()
  } finally {
    apply('TOOLS_ORIGIN', saved.tools)
    apply('NEXT_PUBLIC_APP_URL', saved.app)
  }
}

// ── env parsing ──

test('toolsOrigin trims, drops trailing slashes, and treats junk as unset', () => {
  withEnv({ tools: 'http://127.0.0.1:3000' }, () => {
    assert.equal(toolsOrigin(), 'http://127.0.0.1:3000')
    assert.equal(toolsOriginConfigured(), true)
  })
  withEnv({ tools: '  https://tools.visvine.com//  ' }, () => {
    assert.equal(toolsOrigin(), 'https://tools.visvine.com')
  })
  for (const junk of [undefined, '', '   ', 'tools.visvine.com', 'javascript:alert(1)', 'file:///etc']) {
    withEnv({ tools: junk }, () => {
      assert.equal(toolsOrigin(), null, String(junk))
      assert.equal(toolsOriginConfigured(), false, String(junk))
    })
  }
})

test('appOrigin falls back to the dev default', () => {
  withEnv({ app: 'https://visvine.com/' }, () => assert.equal(appOrigin(), 'https://visvine.com'))
  withEnv({ app: undefined }, () => assert.equal(appOrigin(), 'http://localhost:3000'))
})

test('toolsOrigin treats a TOOLS_ORIGIN equal to the app origin as unset', () => {
  withEnv({ tools: 'https://visvine.com', app: 'https://visvine.com' }, () => {
    assert.equal(toolsOrigin(), null)
    assert.equal(toolsOriginConfigured(), false)
    assert.equal(toolsHostDecision('visvine.com', '/directory'), 'app')
  })
  // The default-port-folded variant is still the same origin.
  withEnv({ tools: 'https://visvine.com', app: 'https://visvine.com:443' }, () => {
    assert.equal(toolsOrigin(), null)
    assert.equal(toolsOriginConfigured(), false)
  })
  withEnv({ tools: 'https://visvine.com:443', app: 'https://visvine.com' }, () => {
    assert.equal(toolsOrigin(), null)
    assert.equal(toolsOriginConfigured(), false)
  })
  // A genuinely different host still splits as it does today.
  withEnv({ tools: 'http://127.0.0.1:3000', app: 'http://localhost:3000' }, () => {
    assert.equal(toolsOrigin(), 'http://127.0.0.1:3000')
    assert.equal(toolsOriginConfigured(), true)
  })
})

// ── host matching ──

test('isToolsHost compares host and port against TOOLS_ORIGIN', () => {
  withEnv({ tools: 'http://127.0.0.1:3000' }, () => {
    assert.equal(isToolsHost('127.0.0.1:3000'), true)
    // The app host in dev is the same server on the same port — a different
    // ORIGIN is the entire point, so this must not match.
    assert.equal(isToolsHost('localhost:3000'), false)
    assert.equal(isToolsHost('127.0.0.1:3001'), false, 'a different port is a different origin')
    assert.equal(isToolsHost('127.0.0.1'), false, 'the port is part of the origin')
    assert.equal(isToolsHost(null), false)
  })
  withEnv({ tools: 'https://tools.visvine.com' }, () => {
    assert.equal(isToolsHost('tools.visvine.com'), true)
    assert.equal(isToolsHost('TOOLS.visvine.com'), true, 'Host is case-insensitive')
    assert.equal(isToolsHost('tools.visvine.com:443'), true, 'the default port is implied')
    assert.equal(isToolsHost('tools.visvine.com:8443'), false)
    assert.equal(isToolsHost('visvine.com'), false)
    assert.equal(isToolsHost('tools.visvine.com.evil.example'), false)
  })
  // Unset: there is no separate origin, so nothing is the tools host.
  withEnv({ tools: undefined }, () => {
    assert.equal(isToolsHost('tools.visvine.com'), false)
    assert.equal(isToolsHost('127.0.0.1:3000'), false)
  })
})

test('isToolRuntimePath matches the runtime prefix only', () => {
  assert.equal(TOOL_RUNTIME_PATH_PREFIX, '/api/tools/runtime/')
  for (const ok of [
    '/api/tools/runtime',
    '/api/tools/runtime/frame',
    '/api/tools/runtime/bundle/v_123',
    '/api/tools/runtime/vendor/react.js',
  ]) {
    assert.equal(isToolRuntimePath(ok), true, ok)
  }
  for (const no of [
    '/',
    '/directory',
    '/api/tools',
    '/api/tools/bridge',
    '/api/tools/runtimex/frame',
    '/api/notes/search',
    '/_next/static/chunk.js',
  ]) {
    assert.equal(isToolRuntimePath(no), false, no)
  }
})

// ── the proxy's host split ──

test('toolsHostDecision serves only the runtime on the tools host', () => {
  withEnv({ tools: 'http://127.0.0.1:3000' }, () => {
    assert.equal(toolsHostDecision('127.0.0.1:3000', '/api/tools/runtime/frame'), 'tool-runtime')
    // Everything else on that host is a 404 — no app page, no session-bearing
    // API, not even the Next asset routes.
    for (const path of ['/directory', '/', '/api/notes/search', '/api/auth/session', '/signin', '/_next/static/x.js']) {
      assert.equal(toolsHostDecision('127.0.0.1:3000', path), 'not-found', path)
    }
    // The same runtime paths stay reachable on the app host (identical URLs, so
    // the same-origin fallback needs no separate routing).
    assert.equal(toolsHostDecision('localhost:3000', '/api/tools/runtime/frame'), 'app')
    assert.equal(toolsHostDecision('localhost:3000', '/directory'), 'app')
  })
  withEnv({ tools: undefined }, () => {
    assert.equal(toolsHostDecision('127.0.0.1:3000', '/directory'), 'app', 'unset = no host split')
    assert.equal(toolsHostDecision('127.0.0.1:3000', '/api/tools/runtime/frame'), 'app')
  })
})

test('frameUrl points at the tools origin, else falls back to the app', () => {
  withEnv({ tools: 'https://tools.visvine.com', app: 'https://visvine.com' }, () => {
    assert.equal(
      frameUrl({ token: 'abc.def' }),
      'https://tools.visvine.com/api/tools/runtime/frame?token=abc.def',
    )
  })
  withEnv({ tools: undefined, app: 'https://visvine.com' }, () => {
    assert.equal(
      frameUrl({ token: 'a+b/c=' }),
      'https://visvine.com/api/tools/runtime/frame?token=a%2Bb%2Fc%3D',
    )
  })
})

// ── the frame's policy ──

test('frameCsp denies everything the bridge replaces', () => {
  const csp = frameCsp({ appOrigin: 'https://visvine.com', selfOrigin: 'https://tools.visvine.com' })
  for (const directive of [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    // A Tool that can read a note must not be able to ship it anywhere: the
    // only way out is postMessage to the host page.
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    'frame-ancestors https://visvine.com',
    "img-src 'self' data: blob: https://storage.googleapis.com",
  ]) {
    assert.ok(csp.includes(directive), directive)
  }
  assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"), 'no inline script')
  assert.ok(!csp.includes('unsafe-eval'))
  assert.ok(!/frame-src|child-src/.test(csp), 'a Tool cannot nest another frame (default-src none)')
})

test('frameCsp appends media hosts and refuses sources that would write policy', () => {
  const csp = frameCsp({
    appOrigin: 'https://visvine.com',
    selfOrigin: 'https://tools.visvine.com',
    mediaHosts: ['https://cdn.visvine.com', "evil'; script-src *", 'https://x.example:8443'],
  })
  assert.ok(csp.includes("img-src 'self' data: blob: https://storage.googleapis.com https://cdn.visvine.com https://x.example:8443"))
  assert.ok(!csp.includes('evil'), 'a source that closes the directive is dropped, not escaped')
  assert.equal(csp.match(/script-src/g)?.length, 1)
})

test('frameCsp uses \'self\' for the same-origin fallback', () => {
  const csp = frameCsp({ appOrigin: 'http://localhost:3000', selfOrigin: 'http://localhost:3000' })
  assert.ok(csp.includes("frame-ancestors 'self'"))
})

test('frameHeaders omits X-Frame-Options and never caches the document', () => {
  const headers = frameHeaders('default-src \'none\'')
  assert.equal(headers['Content-Security-Policy'], "default-src 'none'")
  assert.equal(headers['Referrer-Policy'], 'no-referrer')
  assert.equal(headers['Cross-Origin-Resource-Policy'], 'cross-origin')
  assert.equal(headers['Cache-Control'], 'no-store')
  assert.equal(headers['Content-Type'], 'text/html; charset=utf-8')
  // frame-ancestors is the only directive that can name an allowed embedder;
  // X-Frame-Options would only be able to say "nobody".
  assert.equal(headers['X-Frame-Options'], undefined)
  assert.ok(!Object.keys(headers).some((k) => k.toLowerCase() === 'set-cookie'))
})

test('bundleHeaders caches content-addressed JS forever, working copies never', () => {
  const immutable = bundleHeaders()
  assert.equal(immutable['Content-Type'], 'text/javascript; charset=utf-8')
  assert.equal(immutable['Cross-Origin-Resource-Policy'], 'cross-origin')
  assert.equal(immutable['Cache-Control'], 'public, max-age=31536000, immutable')
  assert.equal(bundleHeaders({ immutable: false })['Cache-Control'], 'no-store')
})

// ── next.config.ts must not let the app-wide policy clobber the frame's own ──

test("next.config's app-wide CSP/X-Frame-Options do not match the Tool runtime, and still match everything else", async () => {
  // Same matcher Next itself compiles `source` strings with, so this pins the
  // config's actual routing behavior rather than a hand-rolled approximation.
  // @ts-expect-error -- Next vendors this with no published types.
  const { pathToRegexp } = (await import('next/dist/compiled/path-to-regexp')) as {
    pathToRegexp: (source: string) => RegExp
  }
  const entries = await nextConfig.headers!()

  const headersFor = (path: string): Record<string, string> => {
    const merged: Record<string, string> = {}
    for (const entry of entries) {
      if (!pathToRegexp(entry.source).test(path)) continue
      for (const h of entry.headers) merged[h.key] = h.value
    }
    return merged
  }

  const runtime = headersFor('/api/tools/runtime/frame')
  assert.equal(runtime['Content-Security-Policy'], undefined, 'the frame mints its own CSP')
  assert.equal(runtime['X-Frame-Options'], undefined, 'XFO has no origin-list form; frame-ancestors owns this')
  assert.equal(runtime['Referrer-Policy'], undefined, 'the frame sets no-referrer itself')
  assert.equal(runtime['Strict-Transport-Security'], 'max-age=63072000; includeSubDomains; preload')
  assert.equal(runtime['Permissions-Policy'], 'camera=(), microphone=(), geolocation=(), browsing-topics=()')

  const directory = headersFor('/directory')
  assert.ok(directory['Content-Security-Policy']?.includes("frame-ancestors 'none'"))
  assert.equal(directory['X-Frame-Options'], 'DENY')

  const authorize = headersFor('/api/oauth/authorize')
  assert.ok(authorize['Content-Security-Policy']?.includes("form-action 'self' https:"))
  assert.equal(authorize['X-Frame-Options'], 'DENY')
})
