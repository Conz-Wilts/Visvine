/**
 * Client identity for the MCP OAuth server: who is asking, and where we are
 * allowed to redirect them.
 *
 * MCP 2026-07-28 makes **Client ID Metadata Documents** the primary registration
 * mechanism and deprecates Dynamic Client Registration. A CIMD client identifies
 * itself with an HTTPS URL that *is* its client_id; we fetch that URL and the
 * document it returns is its registration. Nothing is stored — the client is
 * re-resolved (from cache) on each authorization.
 *
 * `resolveClient` hides the difference: DCR clients still come from the
 * OAuthClient table, CIMD clients come off the network, and both arrive as the
 * same shape.
 */
import { getClient } from '@/lib/mcp/oauth'
import { assertPubliclyRoutable } from '@/lib/net/ssrf'

/** A resolved client, whatever mechanism it registered through. */
export interface McpClient {
  clientId: string
  clientName: string | null
  /** The client's own home page, if it published one. Consent-screen copy only. */
  clientUri: string | null
  redirectUris: string[]
  /** Space-delimited allowlist, or null for "any scope in the catalogue". */
  scope: string | null
  /**
   * `registered` — a row we issued via DCR, so the identifier is ours.
   * `client-id-document` — self-asserted, resolved from the client's own URL.
   * The consent screen says which, because it changes how much the name means.
   */
  source: 'registered' | 'client-id-document'
}

export class ClientResolutionError extends Error {
  /** An OAuth error code suitable for the response: invalid_client / invalid_request. */
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ClientResolutionError'
    this.code = code
  }
}

// ── Client ID URLs ──

/**
 * Is this client_id a Client ID Metadata Document URL rather than an opaque
 * identifier? The spec requires https and a path component, which conveniently
 * means our own `mcp_…` DCR identifiers can never be mistaken for one.
 */
export function isClientIdUrl(clientId: string): boolean {
  if (!clientId.startsWith('https://')) return false
  let url: URL
  try {
    url = new URL(clientId)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.hash) return false
  // "MUST … contain a path component" — a bare origin is not a document.
  if (url.pathname === '' || url.pathname === '/') return false
  return true
}

// ── Redirect URIs ──

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** Schemes that must never appear in a redirect target. */
const DANGEROUS_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:'])

export type ApplicationType = 'native' | 'web'

/**
 * Validate a redirect URI, with the OIDC `application_type` constraints that
 * SEP-837 exists to make survivable.
 *
 * - `native` — loopback HTTP (RFC 8252 §7.3), private-use schemes, and HTTPS.
 * - `web` — HTTPS only, and never loopback (OIDC Dynamic Registration §2).
 *
 * Fragments are rejected for every type: RFC 6749 §3.1.2 forbids them, and the
 * authorization response needs the fragment slot free.
 */
export function validateRedirectUri(
  uri: string,
  applicationType: ApplicationType,
): { ok: true } | { ok: false; reason: string } {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return { ok: false, reason: `'${uri}' is not an absolute URI` }
  }
  if (url.hash) return { ok: false, reason: 'redirect_uris must not contain a fragment' }
  if (DANGEROUS_SCHEMES.has(url.protocol)) {
    return { ok: false, reason: `the '${url.protocol}' scheme is not a valid redirect target` }
  }

  const isLoopback = LOOPBACK_HOSTS.has(url.hostname)

  if (applicationType === 'web') {
    if (url.protocol !== 'https:') {
      return { ok: false, reason: "a 'web' client's redirect_uris must use https" }
    }
    if (isLoopback) {
      return { ok: false, reason: "a 'web' client cannot redirect to loopback — register as 'native'" }
    }
    return { ok: true }
  }

  // native
  if (url.protocol === 'https:') return { ok: true }
  if (url.protocol === 'http:') {
    return isLoopback
      ? { ok: true }
      : { ok: false, reason: 'plain http is only allowed for loopback redirect URIs' }
  }
  // A private-use scheme (RFC 8252 §7.1), e.g. com.example.app:/oauth or cursor://cb.
  return { ok: true }
}

/**
 * Infer `application_type` from the redirect URIs a client registered with.
 *
 * OIDC defaults an omitted `application_type` to `web`, which then rejects the
 * localhost URIs almost every MCP client uses — the exact failure SEP-837 was
 * written to stop. So we infer instead of applying that default: anything that
 * looks native makes the registration native.
 */
export function inferApplicationType(redirectUris: readonly string[]): ApplicationType {
  const looksNative = redirectUris.some((uri) => {
    try {
      const url = new URL(uri)
      if (url.protocol !== 'https:') return true // loopback http, or a private-use scheme
      return LOOPBACK_HOSTS.has(url.hostname)
    } catch {
      return false
    }
  })
  return looksNative ? 'native' : 'web'
}

// ── Client ID Metadata Document fetch ──

const CIMD_TIMEOUT_MS = 5_000
const CIMD_MAX_BYTES = 64 * 1024
const CIMD_MIN_TTL_MS = 60 * 1000
const CIMD_MAX_TTL_MS = 24 * 60 * 60 * 1000
const CIMD_DEFAULT_TTL_MS = 5 * 60 * 1000

interface CacheEntry {
  client: McpClient
  expiresAt: number
}

/** Survives dev HMR, which otherwise re-fetches on every edit. */
const cache: Map<string, CacheEntry> = ((
  globalThis as { __mcpCimdCache?: Map<string, CacheEntry> }
).__mcpCimdCache ??= new Map())

/**
 * Parse and validate a fetched metadata document against the URL it came from.
 * Pure — the network half lives in `fetchClientIdDocument`.
 *
 * The `client_id` equality check is the whole security model of CIMD: it binds
 * the document to the origin that served it, so nobody can publish a document
 * claiming to be someone else's client_id.
 */
export function parseClientIdDocument(url: string, raw: unknown): McpClient {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ClientResolutionError('invalid_client', 'Client ID metadata document is not a JSON object')
  }
  const doc = raw as Record<string, unknown>

  if (doc.client_id !== url) {
    throw new ClientResolutionError(
      'invalid_client',
      'Client ID metadata document does not declare the URL it was fetched from as its client_id',
    )
  }
  if (typeof doc.client_name !== 'string' || doc.client_name.length === 0) {
    throw new ClientResolutionError('invalid_client', 'Client ID metadata document is missing client_name')
  }
  const redirectUris = Array.isArray(doc.redirect_uris)
    ? doc.redirect_uris.filter((u): u is string => typeof u === 'string' && u.length > 0)
    : []
  if (redirectUris.length === 0) {
    throw new ClientResolutionError('invalid_client', 'Client ID metadata document is missing redirect_uris')
  }

  // The document declares its own application_type; absent, infer it rather than
  // applying OIDC's `web` default (see inferApplicationType).
  const declared = doc.application_type
  const applicationType: ApplicationType =
    declared === 'web' || declared === 'native' ? declared : inferApplicationType(redirectUris)

  for (const uri of redirectUris) {
    const check = validateRedirectUri(uri, applicationType)
    if (!check.ok) {
      throw new ClientResolutionError('invalid_client', `Client ID metadata document: ${check.reason}`)
    }
  }

  return {
    clientId: url,
    clientName: doc.client_name,
    clientUri: typeof doc.client_uri === 'string' ? doc.client_uri : null,
    redirectUris,
    scope: typeof doc.scope === 'string' ? doc.scope : null,
    source: 'client-id-document',
  }
}

/**
 * Refuse to fetch anything that resolves inside the network we're running in.
 * A client_id is an attacker-chosen URL that we fetch server-side, so this is
 * the SSRF gate (shared with the connector executors via lib/net/ssrf.ts; DNS
 * can still be re-pointed between this check and the fetch — `redirect: 'error'`
 * below removes the far larger redirect-based hole.)
 */
async function assertClientHostRoutable(hostname: string): Promise<void> {
  try {
    await assertPubliclyRoutable(hostname)
  } catch {
    throw new ClientResolutionError('invalid_client', 'client_id must not resolve to a private address')
  }
}

/** How long to trust a fetched document, from its own cache headers. */
function ttlFromResponse(res: Response): number {
  const header = res.headers.get('cache-control') ?? ''
  if (/no-store|no-cache/i.test(header)) return CIMD_MIN_TTL_MS
  const maxAge = header.match(/max-age\s*=\s*(\d+)/i)
  if (!maxAge) return CIMD_DEFAULT_TTL_MS
  return Math.min(CIMD_MAX_TTL_MS, Math.max(CIMD_MIN_TTL_MS, Number(maxAge[1]) * 1000))
}

async function fetchClientIdDocument(url: string): Promise<{ client: McpClient; ttlMs: number }> {
  await assertClientHostRoutable(new URL(url).hostname)

  let res: Response
  try {
    res = await fetch(url, {
      // A redirect could bounce us to a host that never passed the check above.
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch {
    throw new ClientResolutionError('invalid_client', 'Could not fetch the client ID metadata document')
  }
  if (!res.ok) {
    throw new ClientResolutionError(
      'invalid_client',
      `Client ID metadata document returned HTTP ${res.status}`,
    )
  }

  const body = await res.text()
  if (body.length > CIMD_MAX_BYTES) {
    throw new ClientResolutionError('invalid_client', 'Client ID metadata document is too large')
  }
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    throw new ClientResolutionError('invalid_client', 'Client ID metadata document is not valid JSON')
  }

  return { client: parseClientIdDocument(url, json), ttlMs: ttlFromResponse(res) }
}

// ── Resolution ──

/**
 * Resolve a client_id to its registration, from whichever mechanism it used.
 * Returns null when the identifier is simply unknown; throws
 * ClientResolutionError when it names a document we could fetch but not trust.
 */
export async function resolveClient(clientId: string): Promise<McpClient | null> {
  if (!clientId) return null

  if (isClientIdUrl(clientId)) {
    const hit = cache.get(clientId)
    if (hit && hit.expiresAt > Date.now()) return hit.client
    const { client, ttlMs } = await fetchClientIdDocument(clientId)
    cache.set(clientId, { client, expiresAt: Date.now() + ttlMs })
    return client
  }

  const row = await getClient(clientId)
  if (!row) return null
  return {
    clientId: row.clientId,
    clientName: row.clientName,
    clientUri: null,
    redirectUris: row.redirectUris,
    scope: row.scope,
    source: 'registered',
  }
}
