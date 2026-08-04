/**
 * Connector configuration — the pure half of the connectors feature.
 *
 * A connector is a note at `connectors/<name>.md` whose frontmatter is machine
 * config and whose body is agent-facing docs. This module turns frontmatter
 * into a validated ConnectorConfig and hosts the security-critical string
 * logic: the allowlist grammar, `{{secret:NAME}}` reference handling, and
 * output redaction. No I/O lives here — everything is unit-testable.
 *
 * `alias` (http | postgres | mysql | mcp) picks the executor. It's called an
 * alias, not a kind, because it IS the node alias: a connector note syncs a
 * `connector:` node whose `Node.alias` mirrors this field, so the same value
 * that routes the call also colours the chip in the directory (see the alias
 * notes in lib/types/context.ts).
 *
 * Two invariants the executors rely on:
 *   • Secret VALUES never appear in config — only `{{secret:NAME}}` references.
 *     A postgres/mysql `dsn` (and an http OAuth `client_secret`) must be
 *     exactly one reference; an http/mcp base URL may not contain any (the
 *     host the SSRF check judges must be the host the admin actually wrote).
 *   • No `allow` list means no call is permitted — a connector with docs but
 *     no allow entries is a valid, describe-only connector.
 */
import type { NoteFrontmatter } from '@/lib/notes/shared/types'

export type ConnectorErrorCode =
  | 'denied'
  | 'config'
  | 'missing_secret'
  | 'ssrf'
  | 'timeout'
  | 'upstream'

export class ConnectorError extends Error {
  code: ConnectorErrorCode
  constructor(code: ConnectorErrorCode, message: string) {
    super(message)
    this.name = 'ConnectorError'
    this.code = code
  }
}

export interface AllowRule {
  method: string
  /** Rule path; when `prefix` is true this is the prefix (the `*` stripped). */
  path: string
  prefix: boolean
}

/**
 * OAuth2 client-credentials auth for an http connector, from the frontmatter
 * `auth:` block. The executor exchanges these for a bearer token server-side
 * and caches it until expiry — the model never sees the client secret or the
 * token. `clientSecret` is always exactly one `{{secret:NAME}}` reference;
 * `clientId` may be a literal or a single reference.
 */
export interface OAuth2Config {
  tokenUrl: string
  clientId: string
  clientSecret: string
  scope: string | null
}

export interface HttpConnectorConfig {
  alias: 'http'
  baseUrl: string
  allow: AllowRule[]
  headers: Record<string, string>
  timeoutMs: number
  /** Null = static-header auth only (the common case). */
  oauth: OAuth2Config | null
}

export interface PostgresConnectorConfig {
  alias: 'postgres'
  /** Always a single `{{secret:NAME}}` reference, never a raw DSN. */
  dsn: string
  maxRows: number
  timeoutMs: number
}

export interface MysqlConnectorConfig {
  alias: 'mysql'
  /** Always a single `{{secret:NAME}}` reference, never a raw DSN. */
  dsn: string
  maxRows: number
  timeoutMs: number
}

/** The two DSN-shaped executors share every field except the dialect. */
export type SqlConnectorConfig = PostgresConnectorConfig | MysqlConnectorConfig

export interface McpConnectorConfig {
  alias: 'mcp'
  /** The remote MCP server's streamable-HTTP endpoint. */
  url: string
  /** Tool names this connector may call; a trailing `*` is a prefix match. Empty = discovery-only. */
  allow: string[]
  headers: Record<string, string>
  timeoutMs: number
}

export type ConnectorConfig = HttpConnectorConfig | SqlConnectorConfig | McpConnectorConfig

/** Is this a DSN-backed SQL connector (postgres or mysql)? */
export function isSqlConnector(config: ConnectorConfig): config is SqlConnectorConfig {
  return config.alias === 'postgres' || config.alias === 'mysql'
}

const TIMEOUT_DEFAULT_MS = 10_000
const TIMEOUT_MIN_MS = 1_000
const TIMEOUT_MAX_MS = 30_000
const MAX_ROWS_DEFAULT = 100
const MAX_ROWS_MAX = 1_000

/**
 * The ranges {@link parseConnectorConfig} clamps to. Exported so an editor can
 * refuse an out-of-range value up front rather than accepting a number the note
 * keeps and the executor quietly ignores.
 */
export const CONNECTOR_LIMITS = {
  timeoutMs: { min: TIMEOUT_MIN_MS, max: TIMEOUT_MAX_MS, default: TIMEOUT_DEFAULT_MS },
  maxRows: { min: 1, max: MAX_ROWS_MAX, default: MAX_ROWS_DEFAULT },
} as const

const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/
const SECRET_REF_RE = /\{\{\s*secret:([A-Za-z0-9_]+)\s*\}\}/g

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * `"METHOD /path"` → rule, or null when malformed. A trailing `*` glued to
 * text (`/v1/customers*`) is a prefix match; a `*` that is its own segment
 * (`/v1/charges/*`) matches exactly one segment there.
 */
export function parseAllowRule(raw: string): AllowRule | null {
  const m = raw.trim().match(/^([A-Za-z]+)\s+(\/\S*)$/)
  if (!m) return null
  const method = m[1].toUpperCase()
  let path = m[2]
  const prefix =
    path.endsWith('*') && !path.endsWith('/*') && !path.slice(0, -1).includes('*')
  if (prefix) path = path.slice(0, -1)
  return { method, path, prefix }
}

/**
 * Normalize a request path for matching, refusing anything that could dodge
 * the allowlist: traversal segments, empty segments, percent-encoded dots or
 * slashes, backslashes. Returns null when the path is unacceptable.
 */
export function normalizeRequestPath(path: string): string | null {
  if (!path.startsWith('/')) return null
  if (path.includes('\\') || path.includes('//')) return null
  if (/%2e|%2f|%5c/i.test(path)) return null
  if (path.split('/').some((seg) => seg === '.' || seg === '..')) return null
  return path
}

/**
 * Does the allowlist permit this call? `path` must already be normalized.
 * Prefix rules (`GET /v1/customers*`) match on startsWith; otherwise the paths
 * are compared segment-wise, where a `*` segment in the rule matches exactly
 * one non-empty request segment. An empty list denies everything.
 */
export function matchAllowlist(allow: readonly AllowRule[], method: string, path: string): boolean {
  const wanted = method.toUpperCase()
  return allow.some((rule) => {
    if (rule.method !== wanted) return false
    if (rule.prefix) return path.startsWith(rule.path)
    const ruleSegs = rule.path.split('/')
    const pathSegs = path.split('/')
    if (ruleSegs.length !== pathSegs.length) return false
    return ruleSegs.every((seg, i) => (seg === '*' ? pathSegs[i].length > 0 : seg === pathSegs[i]))
  })
}

/** The distinct secret names referenced as `{{secret:NAME}}` in a template. */
export function findSecretRefs(text: string): string[] {
  const names = new Set<string>()
  for (const m of text.matchAll(SECRET_REF_RE)) names.add(m[1])
  return [...names]
}

export function isValidSecretName(name: string): boolean {
  return SECRET_NAME_RE.test(name)
}

/** Replace every `{{secret:NAME}}` with its value, or report what's missing. */
export function interpolateSecrets(
  template: string,
  secrets: ReadonlyMap<string, string>,
): { ok: true; value: string } | { ok: false; missing: string[] } {
  const missing = findSecretRefs(template).filter((name) => !secrets.has(name))
  if (missing.length > 0) return { ok: false, missing }
  const value = template.replace(SECRET_REF_RE, (_, name: string) => secrets.get(name) ?? '')
  return { ok: true, value }
}

/**
 * Strip resolved secret values out of text bound for the model — the
 * belt-and-braces layer behind "secrets are only interpolated server-side",
 * covering an upstream that echoes its Authorization header back.
 */
export function redactSecrets(text: string, values: readonly string[]): string {
  let out = text
  for (const value of values) {
    if (value.length === 0) continue
    out = out.split(value).join('[redacted]')
  }
  return out
}

function parseHeaders(raw: unknown): Record<string, string> | null {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string' || !/^[\w-]+$/.test(key)) return null
    headers[key] = value
  }
  return headers
}

export type ParseConfigResult =
  | { ok: true; config: ConnectorConfig }
  | { ok: false; error: string }

/** Exactly one `{{secret:NAME}}` reference and nothing else? Returns the NAME. */
function singleSecretRef(text: string): string | null {
  const refs = findSecretRefs(text)
  if (refs.length !== 1 || text.replace(SECRET_REF_RE, '') !== '') return null
  return refs[0]
}

/**
 * A URL an executor will connect to must be written literally in the note —
 * no secret refs steering the host past the SSRF check — and be https outside
 * dev. Returns the parsed URL or an admin-readable error string.
 */
function parseTargetUrl(raw: string, field: string, allowPathQuery = false): URL | string {
  if (findSecretRefs(raw).length > 0) {
    return `\`${field}\` may not contain secret references`
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return `A valid absolute \`${field}\` is required`
  }
  const httpsOk = url.protocol === 'https:'
  const devHttpOk = url.protocol === 'http:' && process.env.NODE_ENV === 'development'
  if (!httpsOk && !devHttpOk) return `\`${field}\` must be https`
  if (!allowPathQuery && (url.search || url.hash)) {
    return `\`${field}\` may not include a query string or fragment`
  }
  return url
}

const MCP_TOOL_RULE_RE = /^[A-Za-z0-9][\w.-]{0,127}\*?$/

/**
 * Does the mcp allowlist permit this tool? Exact name, or prefix when the rule
 * ends in `*`. An empty list denies every call (discovery stays possible —
 * that is how an admin finds the names to allow).
 */
export function matchToolAllowlist(allow: readonly string[], tool: string): boolean {
  return allow.some((rule) =>
    rule.endsWith('*') ? tool.startsWith(rule.slice(0, -1)) : tool === rule,
  )
}

/**
 * Every secret NAME a connector's config references — the set the executor
 * needs resolved, and the set the console shows against stored secrets.
 */
export function configSecretRefs(config: ConnectorConfig): string[] {
  switch (config.alias) {
    case 'postgres':
    case 'mysql':
      return findSecretRefs(config.dsn)
    case 'mcp':
      return [...new Set(Object.values(config.headers).flatMap(findSecretRefs))]
    case 'http': {
      const refs = Object.values(config.headers).flatMap(findSecretRefs)
      if (config.oauth) refs.push(...findSecretRefs(config.oauth.clientId), ...findSecretRefs(config.oauth.clientSecret))
      return [...new Set(refs)]
    }
  }
}

function parseSqlConfig(alias: 'postgres' | 'mysql', fm: NoteFrontmatter, timeoutMs: number): ParseConfigResult {
  const dsn = typeof fm.dsn === 'string' ? fm.dsn.trim() : ''
  const ref = singleSecretRef(dsn)
  if (ref === null) {
    return {
      ok: false,
      error:
        `A ${alias} connector \`dsn\` must be exactly one secret reference like ` +
        '"{{secret:ANALYTICS_DSN}}" — raw connection strings are not allowed in notes',
    }
  }
  if (!isValidSecretName(ref)) {
    return { ok: false, error: `Invalid secret name '${ref}' (use A-Z, 0-9 and _)` }
  }
  return {
    ok: true,
    config: { alias, dsn, maxRows: clamp(fm.max_rows, MAX_ROWS_DEFAULT, 1, MAX_ROWS_MAX), timeoutMs },
  }
}

/** Validated headers map, or an admin-readable error. */
function parseHeadersOrError(
  raw: unknown,
): { ok: true; headers: Record<string, string> } | { ok: false; error: string } {
  const headers = parseHeaders(raw)
  if (headers === null) return { ok: false, error: '`headers` must map header names to string values' }
  for (const name of Object.values(headers).flatMap(findSecretRefs)) {
    if (!isValidSecretName(name)) {
      return { ok: false, error: `Invalid secret name '${name}' (use A-Z, 0-9 and _)` }
    }
  }
  return { ok: true, headers }
}

function parseOAuth(raw: unknown): OAuth2Config | null | { error: string } {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: '`auth` must be a map with token_url, client_id and client_secret' }
  }
  const auth = raw as Record<string, unknown>
  const tokenUrl = typeof auth.token_url === 'string' ? auth.token_url.trim() : ''
  const url = parseTargetUrl(tokenUrl, 'auth.token_url')
  if (typeof url === 'string') return { error: url }

  const clientId = typeof auth.client_id === 'string' ? auth.client_id.trim() : ''
  if (!clientId) return { error: '`auth.client_id` is required' }
  const idRefs = findSecretRefs(clientId)
  if (idRefs.length > 0 && singleSecretRef(clientId) === null) {
    return { error: '`auth.client_id` must be a literal or a single secret reference' }
  }

  const clientSecret = typeof auth.client_secret === 'string' ? auth.client_secret.trim() : ''
  const secretRef = singleSecretRef(clientSecret)
  if (secretRef === null) {
    return {
      error:
        '`auth.client_secret` must be exactly one secret reference like ' +
        '"{{secret:CRM_CLIENT_SECRET}}" — raw secrets are not allowed in notes',
    }
  }
  for (const name of [...idRefs, secretRef]) {
    if (!isValidSecretName(name)) return { error: `Invalid secret name '${name}' (use A-Z, 0-9 and _)` }
  }

  const scope = typeof auth.scope === 'string' && auth.scope.trim() ? auth.scope.trim() : null
  return { tokenUrl, clientId, clientSecret, scope }
}

/** Frontmatter → validated config. Never throws; errors are admin-readable. */
export function parseConnectorConfig(fm: NoteFrontmatter): ParseConfigResult {
  const alias = fm.alias
  if (alias !== 'http' && alias !== 'postgres' && alias !== 'mysql' && alias !== 'mcp') {
    return { ok: false, error: 'Connector frontmatter needs `alias: http`, `postgres`, `mysql` or `mcp`' }
  }
  const timeoutMs = clamp(fm.timeout_ms, TIMEOUT_DEFAULT_MS, TIMEOUT_MIN_MS, TIMEOUT_MAX_MS)

  if (alias === 'postgres' || alias === 'mysql') return parseSqlConfig(alias, fm, timeoutMs)

  if (alias === 'mcp') {
    const rawUrl = typeof fm.url === 'string' ? fm.url.trim() : ''
    // An MCP endpoint is a full path (…/mcp), but still no query/fragment.
    const url = parseTargetUrl(rawUrl, 'url')
    if (typeof url === 'string') return { ok: false, error: url }

    const parsedHeaders = parseHeadersOrError(fm.headers)
    if (!parsedHeaders.ok) return { ok: false, error: parsedHeaders.error }

    const allowRaw = Array.isArray(fm.allow) ? fm.allow : []
    const allow: string[] = []
    for (const entry of allowRaw) {
      if (typeof entry !== 'string' || !MCP_TOOL_RULE_RE.test(entry.trim())) {
        return {
          ok: false,
          error: `Bad allow entry ${JSON.stringify(entry)} — use a tool name, optionally ending in * for a prefix`,
        }
      }
      allow.push(entry.trim())
    }
    return {
      ok: true,
      config: { alias: 'mcp', url: rawUrl.replace(/\/+$/, ''), allow, headers: parsedHeaders.headers, timeoutMs },
    }
  }

  const baseUrl = typeof fm.base_url === 'string' ? fm.base_url.trim() : ''
  const url = parseTargetUrl(baseUrl, 'base_url')
  if (typeof url === 'string') {
    return {
      ok: false,
      error: url === '`base_url` may not contain secret references' ? url + ' — put them in `headers`' : url,
    }
  }

  const parsedHeaders = parseHeadersOrError(fm.headers)
  if (!parsedHeaders.ok) return { ok: false, error: parsedHeaders.error }

  const oauth = parseOAuth(fm.auth)
  if (oauth !== null && 'error' in oauth) return { ok: false, error: oauth.error }

  const allowRaw = Array.isArray(fm.allow) ? fm.allow : []
  const allow: AllowRule[] = []
  for (const entry of allowRaw) {
    const rule = typeof entry === 'string' ? parseAllowRule(entry) : null
    if (!rule) {
      return { ok: false, error: `Bad allow entry ${JSON.stringify(entry)} — use "METHOD /path"` }
    }
    allow.push(rule)
  }

  return {
    ok: true,
    config: { alias: 'http', baseUrl: baseUrl.replace(/\/+$/, ''), allow, headers: parsedHeaders.headers, timeoutMs, oauth },
  }
}

/**
 * The starting note for a connector created from the Create panel.
 *
 * Lives here, beside {@link parseConnectorConfig}, because the whole point is
 * that it round-trips: whatever this writes must parse. The body is a stub of
 * the agent-facing docs, since an admin refines those in the editor afterwards.
 *
 * Secrets are referenced, never carried: an http connector gets a commented-out
 * `headers` block to fill in, and a postgres `dsn` is written as the single
 * `{{secret:NAME}}` reference the parser demands.
 */
export function newConnectorNote(input: {
  name: string
  alias: 'http' | 'postgres' | 'mysql' | 'mcp'
  description?: string
  /** http: the API's base URL. mcp: the server's streamable-HTTP endpoint. */
  baseUrl?: string
  /** http: already-split "METHOD /path" rules. mcp: tool names (trailing `*` = prefix). */
  allow?: readonly string[]
  /** postgres/mysql only — the secret NAME holding the DSN. */
  secretName?: string
}): string {
  const description = (input.description ?? '').trim()
  const front = [`type: connector`, `alias: ${input.alias}`, `title: ${JSON.stringify(input.name)}`]
  if (description) front.push(`description: ${JSON.stringify(description)}`)

  const allow = (input.allow ?? []).map((r) => r.trim()).filter(Boolean)
  const allowYaml =
    allow.length > 0 ? `allow:\n${allow.map((r) => `  - ${JSON.stringify(r)}`).join('\n')}` : `allow: []`

  if (input.alias === 'postgres' || input.alias === 'mysql') {
    front.push(`dsn: "{{secret:${(input.secretName ?? '').trim().toUpperCase()}}}"`)
    front.push(`max_rows: ${MAX_ROWS_DEFAULT}`)
  } else if (input.alias === 'mcp') {
    front.push(`url: ${(input.baseUrl ?? '').trim().replace(/\/+$/, '')}`)
    front.push(allowYaml)
  } else {
    front.push(`base_url: ${(input.baseUrl ?? '').trim().replace(/\/+$/, '')}`)
    front.push(allowYaml)
  }
  front.push(`timeout_ms: ${TIMEOUT_DEFAULT_MS}`)

  const body =
    input.alias === 'postgres' || input.alias === 'mysql'
      ? [
          `${description || `The ${input.name} database.`}`,
          ``,
          `Queries run read-only inside a transaction, one statement at a time, capped at`,
          `${MAX_ROWS_DEFAULT} rows. Describe the tables an agent should know about here.`,
        ]
      : input.alias === 'mcp'
      ? [
          `${description || `The ${input.name} MCP server.`}`,
          ``,
          ...(allow.length
            ? [`Only the tools listed in \`allow\` may be called; anything else is refused before a`,
               `request is sent. Document what each tool does here.`]
            : [`No tools are allowed yet — list the server's tools to find their names, then add`,
               `\`allow\` entries to the frontmatter above. Until then this connector is discovery-only.`]),
          ``,
          `If the server needs auth, add it to the frontmatter as a header referencing a stored`,
          `secret, never as a raw value:`,
          ``,
          '```yaml',
          `headers:`,
          `  Authorization: "Bearer {{secret:${input.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_TOKEN}}"`,
          '```',
        ]
      : [
          `${description || `The ${input.name} API.`}`,
          ``,
          ...(input.allow?.length
            ? [`Only the calls listed in \`allow\` are permitted; anything else is refused before a`,
               `request is sent. Document what each one returns here.`]
            : [`No calls are allowed yet — add \`allow\` entries like \`"GET /customers"\` to the`,
               `frontmatter above. Until then this connector is documentation only.`]),
          ``,
          `If this API needs a key, add it to the frontmatter as a header referencing a stored`,
          `secret, never as a raw value:`,
          ``,
          '```yaml',
          `headers:`,
          `  Authorization: "Bearer {{secret:${input.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_KEY}}"`,
          '```',
        ]

  return `---\n${front.join('\n')}\n---\n\n${body.join('\n')}\n`
}

/** The connector-path escape hatch for dev/VPC-internal targets. */
export function allowPrivateHosts(): boolean {
  return process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS === 'true'
}
