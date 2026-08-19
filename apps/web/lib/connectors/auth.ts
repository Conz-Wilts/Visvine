/**
 * The `auth:` block — a connector that reaches a service which authenticates
 * PEOPLE, not just callers.
 *
 * A `{{secret:NAME}}` credential answers "which system is calling", and every
 * member of a space shares it. That is right for Stripe or Companies House,
 * where there is one company account and everyone sees the same thing. It is
 * wrong for Notion, Linear or Jira, where Sarah and Tom are supposed to see
 * different things — with a shared credential they both see whatever the
 * credential's owner sees, which is either too much or too little and is never
 * what anyone asked for.
 *
 * So a connector may instead declare an OAuth provider, and Visvine keeps the
 * tokens. Two modes, and the difference is the whole design:
 *
 *   mode: user    each person connects their own account. Sarah's runs use
 *                 Sarah's token. Nobody borrows anybody's access. Requires a
 *                 person to be present the first time — so it cannot serve an
 *                 unattended agent.
 *
 *   mode: space   an admin connects once and the whole space shares it. Works
 *                 unattended, which is what makes agents and scheduled jobs
 *                 possible — but everyone with the note now acts as whoever
 *                 connected it. That is a real privilege transfer, so the UI
 *                 names the account out loud and never implies otherwise.
 *
 * The token itself never enters the isolate. It is stamped onto outbound
 * requests by the host (lib/connectors/hostFetch.ts), the same way the identity
 * assertion is, so connector code cannot read it, log it, or send it somewhere
 * the perimeter does not allow.
 */
import { findSecretRefs } from './config'

/** How the connection is shared. */
type ConnectorAuthMode = 'user' | 'space'

/** Where the OAuth endpoints come from. */
type ConnectorAuthDiscovery =
  /** An MCP/OAuth resource URL — endpoints are resolved from its metadata documents. */
  | { kind: 'discover'; url: string }
  /** Endpoints written out. For providers that publish no metadata document. */
  | { kind: 'explicit'; authorizeUrl: string; tokenUrl: string }

export interface ConnectorAuth {
  /**
   * Stable key for the stored connection. Changing it orphans existing
   * connections — everyone reconnects — so it is validated tightly and meant
   * to be chosen once.
   */
  provider: string
  mode: ConnectorAuthMode
  discovery: ConnectorAuthDiscovery
  /**
   * Literal, or one `{{secret:NAME}}` reference. Absent means the client is
   * obtained by dynamic registration at connect time (RFC 7591) — which is
   * what lets an MCP server be added without signing up for anything.
   */
  clientId: string | null
  /** Always a `{{secret:NAME}}` reference when present. Public clients omit it. */
  clientSecret: string | null
  scopes: string[]
  /**
   * Hosts the bearer may be sent to. Empty means every host in the perimeter.
   * Narrow it whenever a note reaches more than one service — an access token
   * handed to the wrong host is a credential leak, not a privacy nuisance.
   */
  hosts: string[]
}

export type ParseAuthResult =
  | { ok: true; auth: ConnectorAuth | null }
  | { ok: false; error: string }

const PROVIDER_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
const SECRET_REF_ONLY_RE = /^\{\{\s*secret:([A-Z][A-Z0-9_]{0,63})\s*\}\}$/

function httpsUrl(raw: unknown, field: string): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: `\`auth.${field}\` must be an https URL` }
  }
  const value = raw.trim()
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return { ok: false, error: `\`auth.${field}\` is not a valid URL` }
  }
  // http:// would put an authorization code, and then a token, on the wire in
  // clear. localhost is the usual dev exception and is not worth the footgun.
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: `\`auth.${field}\` must use https` }
  }
  if (findSecretRefs(value).length > 0) {
    return { ok: false, error: `\`auth.${field}\` must be written literally, not interpolated from a secret` }
  }
  return { ok: true, url: value }
}

/**
 * Parse the optional `auth:` block.
 *
 * Absent is the normal case. Present-but-wrong is an error rather than a silent
 * skip: a note that means to authenticate as a person and quietly does not
 * would fall back to whatever credential is in `env`, which is exactly the
 * shared-account behaviour the block exists to replace.
 */
export function parseConnectorAuth(raw: unknown): ParseAuthResult {
  if (raw === undefined || raw === null) return { ok: true, auth: null }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '`auth` must be a mapping with `provider` and `mode`' }
  }
  const block = raw as Record<string, unknown>

  const provider = typeof block.provider === 'string' ? block.provider.trim().toLowerCase() : ''
  if (!PROVIDER_RE.test(provider)) {
    return {
      ok: false,
      error: '`auth.provider` is required — a short lowercase name like "notion" or "linear"',
    }
  }

  const modeRaw = typeof block.mode === 'string' ? block.mode.trim().toLowerCase() : ''
  if (modeRaw !== 'user' && modeRaw !== 'space') {
    return {
      ok: false,
      error: '`auth.mode` must be `user` (each person connects their own account) or `space` (an admin connects once and everyone shares it)',
    }
  }
  const mode: ConnectorAuthMode = modeRaw

  let discovery: ConnectorAuthDiscovery
  if (block.discover !== undefined && block.discover !== null) {
    const url = httpsUrl(block.discover, 'discover')
    if (!url.ok) return url
    discovery = { kind: 'discover', url: url.url }
  } else {
    const authorize = httpsUrl(block.authorize_url, 'authorize_url')
    if (!authorize.ok) {
      return {
        ok: false,
        error: '`auth` needs either `discover` (a server URL whose metadata names its endpoints) or both `authorize_url` and `token_url`',
      }
    }
    const token = httpsUrl(block.token_url, 'token_url')
    if (!token.ok) return token
    discovery = { kind: 'explicit', authorizeUrl: authorize.url, tokenUrl: token.url }
  }

  let clientId: string | null = null
  if (block.client_id !== undefined && block.client_id !== null) {
    if (typeof block.client_id !== 'string' || !block.client_id.trim()) {
      return { ok: false, error: '`auth.client_id` must be a string' }
    }
    clientId = block.client_id.trim()
  }

  let clientSecret: string | null = null
  if (block.client_secret !== undefined && block.client_secret !== null) {
    const value = typeof block.client_secret === 'string' ? block.client_secret.trim() : ''
    // A literal client secret in a note is a credential in a note. The whole
    // secret-reference scheme exists to stop that.
    if (!SECRET_REF_ONLY_RE.test(value)) {
      return {
        ok: false,
        error: '`auth.client_secret` must be exactly one {{secret:NAME}} reference, never a literal',
      }
    }
    clientSecret = value
  }

  const scopes: string[] = []
  if (block.scopes !== undefined && block.scopes !== null) {
    if (!Array.isArray(block.scopes)) {
      return { ok: false, error: '`auth.scopes` must be a list of scope strings' }
    }
    for (const entry of block.scopes) {
      const value = typeof entry === 'string' ? entry.trim() : ''
      if (!value || /\s/.test(value)) {
        return { ok: false, error: `Bad scope entry ${JSON.stringify(entry)} — scopes are space-delimited tokens` }
      }
      scopes.push(value)
    }
  }

  const hosts: string[] = []
  if (block.hosts !== undefined && block.hosts !== null) {
    if (!Array.isArray(block.hosts)) {
      return { ok: false, error: '`auth.hosts` must be a list of host or host:port entries' }
    }
    for (const entry of block.hosts) {
      const value = typeof entry === 'string' ? entry.trim().toLowerCase().replace(/\.$/, '') : ''
      if (!value) return { ok: false, error: `Bad auth.hosts entry ${JSON.stringify(entry)}` }
      hosts.push(value)
    }
  }

  return { ok: true, auth: { provider, mode, discovery, clientId, clientSecret, scopes, hosts } }
}

/** Secret names an `auth:` block references, for the run's secret resolution. */
export function authSecretRefs(auth: ConnectorAuth): string[] {
  const names: string[] = []
  if (auth.clientId) names.push(...findSecretRefs(auth.clientId))
  if (auth.clientSecret) names.push(...findSecretRefs(auth.clientSecret))
  return [...new Set(names)]
}

/**
 * Who a connection belongs to. `mode: space` collapses every member onto one
 * row; `mode: user` gives each their own.
 *
 * The empty string rather than null is deliberate: Postgres treats NULLs as
 * distinct in a unique index, so a nullable column would happily accept two
 * space-mode connections for the same connector.
 */
export function connectionOwner(auth: ConnectorAuth, userId: string): string {
  return auth.mode === 'space' ? '' : userId
}
