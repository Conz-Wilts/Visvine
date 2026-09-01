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
 *                 Sarah's token. Nobody borrows anybody's access. A person is
 *                 present the FIRST time only; after that the stored refresh
 *                 token serves their scheduled runs unattended
 *                 (connections.ts#renew), which is what lets one agent fan out
 *                 to every subscriber on their own accounts.
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
import { platformClientRef } from './platformClients'

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
   * Extra literal query parameters for the authorization URL — Google's
   * `access_type: offline` / `prompt: consent`, without which it never issues
   * a refresh token. Literals only, and never a parameter the flow itself
   * owns; they can widen a consent screen, not the protocol.
   */
  params: Record<string, string>
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
const PARAM_KEY_RE = /^[a-z0-9_]{1,64}$/
const MAX_PARAMS = 10
const MAX_PARAM_VALUE_LENGTH = 256

/**
 * Parameters the flow itself sets. A note naming one is confused at best and
 * an attempt to redirect the code or drop PKCE at worst; either way the answer
 * is a refusal that names the proper key, not a silent override.
 */
const RESERVED_AUTHORIZE_PARAMS = new Set([
  'response_type',
  'client_id',
  'client_secret',
  'redirect_uri',
  'state',
  'code_challenge',
  'code_challenge_method',
  'scope',
  'resource',
  'code',
  'grant_type',
])

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

  // A platform client's secret comes from env; a note pairing the platform id
  // with its own secret is describing two different clients at once.
  if (clientId && platformClientRef(clientId) && clientSecret) {
    return {
      ok: false,
      error: '`auth.client_secret` must be omitted when `client_id` names a platform client — the deployment holds that secret',
    }
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

  const params: Record<string, string> = {}
  if (block.params !== undefined && block.params !== null) {
    if (typeof block.params !== 'object' || Array.isArray(block.params)) {
      return { ok: false, error: '`auth.params` must be a mapping of literal query parameters' }
    }
    const entries = Object.entries(block.params as Record<string, unknown>)
    if (entries.length > MAX_PARAMS) {
      return { ok: false, error: `\`auth.params\` may carry at most ${MAX_PARAMS} entries` }
    }
    for (const [rawKey, rawValue] of entries) {
      const key = rawKey.trim().toLowerCase()
      if (!PARAM_KEY_RE.test(key)) {
        return { ok: false, error: `Bad auth.params key ${JSON.stringify(rawKey)} — lowercase letters, digits and underscores` }
      }
      if (RESERVED_AUTHORIZE_PARAMS.has(key)) {
        return { ok: false, error: `\`auth.params.${key}\` is reserved — the flow sets it itself` }
      }
      const value = typeof rawValue === 'string' ? rawValue.trim() : ''
      if (!value || value.length > MAX_PARAM_VALUE_LENGTH) {
        return { ok: false, error: `\`auth.params.${key}\` must be a short literal string` }
      }
      // A secret in a query string is a credential in a browser history.
      if (findSecretRefs(value).length > 0) {
        return { ok: false, error: `\`auth.params.${key}\` must be written literally, not interpolated from a secret` }
      }
      params[key] = value
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

  return { ok: true, auth: { provider, mode, discovery, clientId, clientSecret, scopes, params, hosts } }
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
