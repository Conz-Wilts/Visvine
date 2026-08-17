/**
 * The Tool frame origin — where a user-built Tool's iframe is served from, and
 * the host split that keeps it away from the app.
 *
 * A Tool is third-party code. It renders in an iframe whose document comes from
 * a SEPARATE, COOKIE-LESS origin so that even a total escape of the CSP/sandbox
 * lands on a host where no `auth_session` cookie exists and no app route
 * answers. That origin is one env var:
 *
 *   prod   TOOLS_ORIGIN=https://tools.visvine.com   (same Cloud Run service,
 *          a domain mapping the operator adds — see docs/tools.md)
 *   dev    TOOLS_ORIGIN=http://127.0.0.1:3000       (the same dev server as
 *          http://localhost:3000, but a different ORIGIN, so cookies scoped to
 *          localhost are not sent and vice versa)
 *
 * Unset is a supported state, not a failure: `frameUrl` falls back to the app
 * origin (same-origin frame, still `sandbox="allow-scripts"` + strict CSP) so
 * the feature works before the DNS work is done. `toolsOriginConfigured()` is
 * what the UI uses to warn that the stronger isolation is off.
 *
 * Everything here is pure apart from reading `process.env` at call time (never
 * at module load — proxy.ts and the tests both need to see env changes), so
 * `toolsHostDecision` — the whole of the proxy's host split — is unit-testable.
 */

/** Every path the tools host is allowed to answer sits under this prefix. */
export const TOOL_RUNTIME_PATH_PREFIX = '/api/tools/runtime/'

/** The audience-scoped frame URL path (the only entry point on the tools host). */
const FRAME_PATH = `${TOOL_RUNTIME_PATH_PREFIX}frame`

const DEFAULT_APP_ORIGIN = 'http://localhost:3000'

/** Default ports, so `tools.visvine.com` and `tools.visvine.com:443` match. */
const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' }

function readOrigin(raw: string | undefined): string | null {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '')
  if (!trimmed) return null
  // A malformed value must not become a hard failure (the fallback path is the
  // whole point) and must never be pasted into a CSP or a URL unchecked.
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  } catch {
    return null
  }
  return trimmed
}

/** Whether two origins name the same host, folding each one's own default port. */
function sameCanonicalOrigin(a: string, b: string): boolean {
  const urlA = new URL(a)
  const urlB = new URL(b)
  return canonicalHost(urlA.host, urlA.protocol) === canonicalHost(urlB.host, urlB.protocol)
}

let warnedSameOriginAsApp = false

/**
 * `TOOLS_ORIGIN`, trimmed and without a trailing slash, or null when unset,
 * unparseable, or equal to the app's own origin (treated the same as unset:
 * a TOOLS_ORIGIN that can't possibly be a separate origin must degrade to the
 * same-origin fallback, never take the whole app down with 404s — see the
 * module doc comment above).
 */
export function toolsOrigin(): string | null {
  const origin = readOrigin(process.env.TOOLS_ORIGIN)
  if (!origin) return null
  if (sameCanonicalOrigin(origin, appOrigin())) {
    if (!warnedSameOriginAsApp) {
      warnedSameOriginAsApp = true
      console.warn(
        'TOOLS_ORIGIN is the same origin as NEXT_PUBLIC_APP_URL — falling back to the same-origin sandbox instead of splitting hosts.',
      )
    }
    return null
  }
  return origin
}

/** Whether the separate Tool origin is configured (vs the same-origin fallback). */
export function toolsOriginConfigured(): boolean {
  return toolsOrigin() !== null
}

/** The app's own origin — `NEXT_PUBLIC_APP_URL`, else the dev default. */
export function appOrigin(): string {
  return readOrigin(process.env.NEXT_PUBLIC_APP_URL) ?? DEFAULT_APP_ORIGIN
}

/** Splits `host[:port]`, tolerating a bracketed IPv6 literal. */
function splitHostPort(value: string): { host: string; port: string | null } {
  const lowered = value.trim().toLowerCase()
  const bracket = lowered.lastIndexOf(']')
  const colon = lowered.lastIndexOf(':')
  if (colon > bracket) return { host: lowered.slice(0, colon), port: lowered.slice(colon + 1) }
  return { host: lowered, port: null }
}

/** `host[:port]` with the protocol's default port dropped, for comparison. */
function canonicalHost(value: string, protocol: string): string {
  const { host, port } = splitHostPort(value)
  if (!port || port === DEFAULT_PORTS[protocol]) return host
  return `${host}:${port}`
}

/**
 * Whether a request's `Host` header names the tools origin. False when
 * `TOOLS_ORIGIN` is unset — with no separate origin configured there is no
 * host to split off, and everything is the app.
 */
export function isToolsHost(hostHeader: string | null): boolean {
  const origin = toolsOrigin()
  if (!origin || !hostHeader) return false
  const url = new URL(origin)
  return canonicalHost(hostHeader, url.protocol) === canonicalHost(url.host, url.protocol)
}

/** Whether a pathname belongs to the Tool runtime (frame document, bundles, vendor ESM). */
export function isToolRuntimePath(pathname: string): boolean {
  return (
    pathname === TOOL_RUNTIME_PATH_PREFIX.slice(0, -1) ||
    pathname.startsWith(TOOL_RUNTIME_PATH_PREFIX)
  )
}

/**
 * The proxy's host split, as a pure decision:
 *
 *   `app`          not the tools host — carry on with the normal session gate.
 *   `tool-runtime` the tools host asking for a runtime path: pass through
 *                  unauthenticated (the frame token authenticates it) and, as
 *                  everywhere on this host, do not read or write a cookie.
 *   `not-found`    the tools host asking for anything else. 404. The tools host
 *                  must never serve the app, a page, or a session-bearing API.
 *
 * Runtime paths stay reachable on the APP host too: that is the same-origin
 * fallback when `TOOLS_ORIGIN` is unset, and the URLs are identical either way.
 */
export type ToolsHostDecision = 'app' | 'tool-runtime' | 'not-found'

export function toolsHostDecision(hostHeader: string | null, pathname: string): ToolsHostDecision {
  if (!isToolsHost(hostHeader)) return 'app'
  return isToolRuntimePath(pathname) ? 'tool-runtime' : 'not-found'
}

/**
 * The `src` for a Tool iframe: the tools origin when configured, else the app
 * origin (same-origin fallback). The token is the only credential the frame
 * gets — see lib/tools/frameToken.ts.
 */
export function frameUrl(params: { token: string }): string {
  const base = toolsOrigin() ?? appOrigin()
  return `${base}${FRAME_PATH}?token=${encodeURIComponent(params.token)}`
}
