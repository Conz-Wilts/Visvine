/**
 * The headers a Tool frame is served with — the second half of the sandbox.
 *
 * The first half is the origin (lib/tools/origin.ts) plus
 * `sandbox="allow-scripts"` on the iframe, which denies the frame same-origin
 * access to anything. This module writes the policy that decides what the
 * document inside it may *load*, and the one thing it deliberately cannot do:
 *
 *   `connect-src 'none'`  no fetch, no XHR, no WebSocket, no EventSource. A
 *                         Tool's only way out is postMessage to the host page,
 *                         which forwards to /api/tools/bridge under the viewer's
 *                         session. That is the exfiltration control: a Tool that
 *                         can read a note cannot ship it anywhere.
 *   `script-src 'self'`   only the compiled bundle + vendor ESM this server
 *                         built; no CDNs, no eval, no inline script.
 *   `frame-ancestors`     only the Visvine app may embed the frame, so the URL
 *                         is useless if it leaks.
 *
 * `X-Frame-Options` is intentionally absent: it has no origin-list form, so
 * `frame-ancestors` is the only directive that can express "the app, and nothing
 * else". Everything is pure string building — no env, no I/O.
 */

/** Where uploaded media lives (lib/gcs.ts serves it public, so images just load). */
const MEDIA_ORIGIN = 'https://storage.googleapis.com'

/** Immutable-cache lifetime for content-addressed bundle URLs (one year). */
const BUNDLE_MAX_AGE = 31536000

/**
 * A CSP source is host/scheme text only. Anything else — a `;` closing the
 * directive, whitespace starting a new source, a quote — would let a caller
 * write policy rather than name a host, so it is dropped rather than escaped.
 */
const SAFE_SOURCE_RE = /^[a-z][a-z0-9+.-]*:\/\/[a-z0-9.*-]+(?::\d+)?$/i

function safeSources(values: readonly string[]): string[] {
  return values.filter((v) => SAFE_SOURCE_RE.test(v))
}

/** A nonce is base64/base64url text; anything else would be writing policy. */
const SAFE_NONCE_RE = /^[A-Za-z0-9+/_=-]{16,128}$/

export function frameCsp(opts: {
  /** The Visvine app origin — the only page allowed to embed this frame. */
  appOrigin: string
  /** The origin the frame document itself is served from (the tools origin). */
  selfOrigin: string
  /** Extra image hosts, e.g. a CDN in front of the media bucket. */
  mediaHosts?: string[]
  /**
   * Per-response nonce for the frame document's two inline scripts — the
   * import map (which has no reliable external form) and the boot module.
   * Everything else stays `'self'`, so a Tool's own bundle still cannot run
   * inline script: it never sees this value.
   */
  nonce?: string
}): string {
  const imgSources = ["'self'", 'data:', 'blob:', MEDIA_ORIGIN, ...safeSources(opts.mediaHosts ?? [])]
  // When the tools origin is unconfigured the frame is same-origin with the app
  // (the documented dev/pre-DNS fallback), and `'self'` is then both correct and
  // narrower than naming the origin.
  const ancestors =
    opts.appOrigin === opts.selfOrigin ? ["'self'"] : safeSources([opts.appOrigin])
  const scriptSources = ["'self'"]
  if (opts.nonce && SAFE_NONCE_RE.test(opts.nonce)) scriptSources.push(`'nonce-${opts.nonce}'`)
  return [
    "default-src 'none'",
    `script-src ${scriptSources.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSources.join(' ')}`,
    "font-src 'self' data:",
    "connect-src 'none'",
    `frame-ancestors ${ancestors.length ? ancestors.join(' ') : "'none'"}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

/**
 * Headers for the frame DOCUMENT. Never cached: the document embeds a
 * short-lived frame token and the bundle URL of whatever version is pinned right
 * now, and it must never be served to a different viewer from a shared cache.
 */
export function frameHeaders(csp: string): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': csp,
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  }
}

/**
 * Headers for a Tool's JS assets (compiled bundle, vendor ESM). Bundle URLs are
 * content-addressed, so the default is a year of immutable caching; pass
 * `{ immutable: false }` for a URL that can change under the same path (an
 * author's working copy while they iterate).
 *
 * `Access-Control-Allow-Origin` is not optional here, and the reason is easy to
 * miss: the frame is sandboxed WITHOUT `allow-same-origin`, so its origin is
 * the opaque `null`. Every ES module fetch is a CORS request, which makes even
 * the frame's own bundle — same URL origin as the document — cross-origin to
 * itself. Without this the browser blocks the import and the Tool never boots.
 * Safe as `*` because nothing here is credentialed: module fetches send no
 * cookies, and the tools host has none to send.
 */
export function bundleHeaders(opts: { immutable?: boolean } = {}): Record<string, string> {
  const immutable = opts.immutable ?? true
  return {
    'Content-Type': 'text/javascript; charset=utf-8',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': immutable ? `public, max-age=${BUNDLE_MAX_AGE}, immutable` : 'no-store',
  }
}
