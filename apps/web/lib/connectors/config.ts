/**
 * Connector configuration — the pure half of the connectors feature.
 *
 * A connector is a note at `connectors/<name>.md` whose frontmatter declares a
 * perimeter (AGENTS.md#connectors) and whose body is agent-facing docs. This
 * module hosts the security-critical string logic — the allowlist grammar,
 * `{{secret:NAME}}` reference handling, output redaction, perimeter parsing —
 * plus the legacy v1 parser the back-compat shim and migration script feed on.
 * No I/O lives here; everything is unit-testable.
 *
 * `alias` is display metadata only (any string): a connector note syncs a
 * `connector:` node whose `Node.alias` mirrors this field, which colours the
 * chip in the directory (see the alias notes in lib/types/context.ts).
 *
 * The invariants the runtime relies on:
 *   • Secret VALUES never appear in notes — only `{{secret:NAME}}` references,
 *     and under v2 only inside `env:` values.
 *   • `hosts` entries are written literally — no secret refs steering the host
 *     past the egress gate — and empty `hosts` means no network at all.
 */
import type { NoteFrontmatter } from '@/lib/notes/shared/types'
import {
  identitySecretName,
  parseConnectorIdentity,
  type ConnectorIdentity,
} from './identity'
import { authSecretRefs, parseConnectorAuth, type ConnectorAuth } from './auth'
import { parseConnectorWebhook, type ConnectorWebhook } from './webhookConfig'

export type ConnectorErrorCode =
  | 'denied'
  | 'config'
  | 'missing_secret'
  | 'ssrf'
  | 'timeout'
  | 'upstream'
  /** The space is over its per-minute run budget or its concurrency cap (lib/connectors/quota.ts). */
  | 'rate_limited'

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
 * `auth:` block, read only to collect its secret names and hosts.
 * `clientSecret` is always exactly one `{{secret:NAME}}` reference;
 * `clientId` may be a literal or a single reference.
 */
interface OAuth2Config {
  tokenUrl: string
  clientId: string
  clientSecret: string
  scope: string | null
}

interface HttpConnectorConfig {
  alias: 'http'
  baseUrl: string
  allow: AllowRule[]
  headers: Record<string, string>
  timeoutMs: number
  /** Null = static-header auth only (the common case). */
  oauth: OAuth2Config | null
}

interface PostgresConnectorConfig {
  alias: 'postgres'
  /** Always a single `{{secret:NAME}}` reference, never a raw DSN. */
  dsn: string
  maxRows: number
  timeoutMs: number
}

interface MysqlConnectorConfig {
  alias: 'mysql'
  /** Always a single `{{secret:NAME}}` reference, never a raw DSN. */
  dsn: string
  maxRows: number
  timeoutMs: number
}

/** The two DSN-shaped executors share every field except the dialect. */
type SqlConnectorConfig = PostgresConnectorConfig | MysqlConnectorConfig

interface McpConnectorConfig {
  alias: 'mcp'
  /** The remote MCP server's streamable-HTTP endpoint. */
  url: string
  /** Tool names this connector may call; a trailing `*` is a prefix match. Empty = discovery-only. */
  allow: string[]
  headers: Record<string, string>
  timeoutMs: number
}

export type ConnectorConfig = HttpConnectorConfig | SqlConnectorConfig | McpConnectorConfig

const TIMEOUT_DEFAULT_MS = 10_000
const TIMEOUT_MIN_MS = 1_000
const TIMEOUT_MAX_MS = 30_000
const MAX_ROWS_DEFAULT = 100
const MAX_ROWS_MAX = 1_000

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

// ── Host matching ────────────────────────────────────────────────────────────
// Pure and dependency-free on purpose: this module is imported by client
// components (the connector page, the Create panel), so nothing reachable from
// it — including identity.ts, which needs `hostAllowed` — may touch a Node-only
// module. The SSRF half of the host gate stays in perimeter.ts.

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '')
}

/**
 * Does the perimeter list this host+port? An entry without a port pins the
 * caller's default; an explicit `host:port` entry allows exactly that port.
 */
export function hostAllowed(
  hosts: readonly string[],
  hostname: string,
  port: number,
  defaultPort: number,
): boolean {
  const wanted = normalizeHost(hostname)
  return hosts.some((entry) => {
    const [entryHost, entryPort] = splitHostPort(entry)
    if (normalizeHost(entryHost) !== wanted) return false
    return entryPort === null ? port === defaultPort : port === entryPort
  })
}

/** `host[:port]` → parts; a bad port reads as null (host-only entry). */
function splitHostPort(entry: string): [string, number | null] {
  const m = entry.match(/^(.*):(\d{1,5})$/)
  if (!m) return [entry, null]
  const port = Number(m[2])
  return port >= 1 && port <= 65535 ? [m[1], port] : [entry, null]
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
 * Lives here, beside {@link parseConnectorPerimeter}, because the whole point
 * is that it round-trips: whatever this writes must parse. The body is a stub
 * of the agent-facing docs, since an admin refines those in the editor
 * afterwards.
 *
 * Secrets are referenced, never carried: `secretName` becomes an `env:` entry
 * whose value is the `{{secret:NAME}}` reference the runtime resolves.
 */
export function newConnectorNote(input: {
  name: string
  description?: string
  /** `host` or `host:port` entries the isolate may reach. Empty = no network yet. */
  hosts?: readonly string[]
  /** Optional NAME of a stored secret, exposed to the code as env.NAME. */
  secretName?: string
}): string {
  const description = (input.description ?? '').trim()
  const hosts = (input.hosts ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean)
  const secret = (input.secretName ?? '').trim().toUpperCase()

  const front = [`type: connector`, `title: ${JSON.stringify(input.name)}`]
  if (description) front.push(`description: ${JSON.stringify(description)}`)
  front.push(hosts.length > 0 ? `hosts:\n${hosts.map((h) => `  - ${h}`).join('\n')}` : `hosts: []`)
  if (secret) front.push(`env:\n  ${secret}: "{{secret:${secret}}}"`)
  front.push(`timeout_ms: ${SANDBOX_LIMITS.timeoutMs.default}`)

  const host = hosts[0] ?? 'api.example.com'
  const body = [
    `${description || `The ${input.name} service.`}`,
    ``,
    `Agents use this by writing JavaScript in an isolate`,
    hosts.length > 0
      ? `that can only reach ${hosts.join(', ')}. Document the service here with working`
      : `with no network yet — add \`hosts:\` above to let the code reach the service, then`,
    hosts.length > 0 ? `example code, e.g.:` : `document it here with working example code, e.g.:`,
    ``,
    '```js',
    secret
      ? `const res = await fetch('https://${host}/v1/things', {`
      : `const res = await fetch('https://${host}/v1/things')`,
    ...(secret ? [`  headers: { Authorization: \`Bearer \${env.${secret}}\` },`, `})`] : []),
    `return JSON.parse(res.body)`,
    '```',
    ``,
    "`fetch` gives you { status, ok, headers, body, truncated } — `body` is a string,",
    'so parse it yourself. `sql(dsn, query)` and `mcp(url)` are available too.',
    ...(secret
      ? [
          ``,
          `The ${secret} secret is set on the connector's page and reaches the code as`,
          `env.${secret} — never write its value into this note.`,
        ]
      : []),
  ]

  return `---\n${front.join('\n')}\n---\n\n${body.join('\n')}\n`
}

/** True when this process is serving real traffic, not a dev machine or a test run. */
function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production'
}

/**
 * The connector-path escape hatch for dev/VPC-internal targets.
 *
 * In production this is not an escape hatch but a hole: it disarms the SSRF
 * check, so a connector could name an internal host and reach the database,
 * the cloud metadata service, or the app's own loopback. Refusing loudly beats
 * silently ignoring it — a misconfigured deploy should fail the call, not
 * quietly run with a weaker perimeter than the operator believes.
 */
export function allowPrivateHosts(): boolean {
  if (process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS !== 'true') return false
  if (isProductionRuntime()) {
    throw new ConnectorError(
      'config',
      'CONNECTORS_ALLOW_PRIVATE_HOSTS is set in production — that disables the SSRF guard on every connector. Unset it and redeploy.',
    )
  }
  return true
}

// Connectors v2 — the perimeter (AGENTS.md#connectors)
//
// A v2 connector's frontmatter no longer picks an executor; it declares a
// perimeter the isolate runtime enforces: hosts the run may reach, env vars it
// receives (secret refs resolved server-side), and limits. `alias` survives as
// pure display metadata — any string, coloured by the same Node.alias chip
// mechanism — and the body teaches the agent how to call the service.
//
// Legacy notes (`alias: http|postgres|mysql|mcp` with the old fields) still
// parse: parseConnectorPerimeter maps them onto perimeters until the migration
// script rewrites them. Detection is by shape, not alias — `hosts:` or `env:`
// present means v2.

export interface ConnectorPerimeter {
  /** `host` or `host:port` entries the run may reach. Empty = no network. */
  hosts: string[]
  /** Optional method+path rules, checked on every request. */
  allow: AllowRule[]
  /** Env var templates — values may hold `{{secret:NAME}}` refs, resolved at run time. */
  env: Record<string, string>
  timeoutMs: number
  /**
   * Optional runtime-stamped caller identity (lib/connectors/identity.ts).
   * Null for the overwhelming majority of connectors. Its signing key is
   * resolved server-side and deliberately never joins `env`, so isolate code
   * can neither read it nor forge the header it produces.
   */
  identity: ConnectorIdentity | null
  /**
   * Optional OAuth connection (lib/connectors/auth.ts) — for a service that
   * authenticates PEOPLE rather than callers. Visvine holds the tokens and
   * stamps the bearer; the isolate never sees one.
   */
  auth: ConnectorAuth | null
  /**
   * Named, reviewable entry points (`actions:` in the frontmatter). Each is a
   * body of JavaScript the runtime evaluates in place of caller-written code,
   * with the caller's `args` installed as a frozen global. Empty for the
   * common code-only connector.
   */
  actions: Record<string, ConnectorAction>
  /**
   * Optional inbound address (`webhook:` in the frontmatter, lib/connectors/webhook.ts).
   * Its signing secret is resolved only by the inbound route and is NOT part
   * of `perimeterSecretRefs` — connector code never sees the key that
   * authenticates its own inbox.
   */
  webhook: ConnectorWebhook | null
}

/** One named action: fixed code an author wrote, run with the caller's `args`. */
export interface ConnectorAction {
  description: string | null
  /** A JSON-schema-ish description of `args`, stored verbatim for the caller's benefit. */
  params: unknown | null
  code: string
}

/** Limits on the `actions:` block. */
const ACTION_LIMITS = {
  nameRe: /^[a-z][a-z0-9_]{0,63}$/,
  maxActions: 32,
  maxCodeChars: 32 * 1024,
} as const

/** Limits the isolate runtime clamps to; exported so editors can refuse out-of-range values up front. */
export const SANDBOX_LIMITS = {
  timeoutMs: { min: 1_000, max: 120_000, default: 30_000 },
  outputCapBytes: 256 * 1024,
} as const

/**
 * Total size of a perimeter's env, so a note can't eat the isolate's memory
 * budget before a line of its code runs.
 *
 * There is no reserved-NAME list: egress is a host function that no environment
 * variable influences, and `env` is a namespace object, so a variable called
 * `fetch` is `env.fetch` and shadows nothing.
 */
const ENV_MAX_BYTES = 64 * 1024

/** Hostname (or IP) with optional :port — no scheme, path, wildcard or secret ref. */
const HOST_ENTRY_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

export type ParsePerimeterResult =
  | {
      ok: true
      perimeter: ConnectorPerimeter
      /** Set when this came from a legacy alias note the migration hasn't rewritten. */
      legacy: 'http' | 'postgres' | 'mysql' | 'mcp' | null
      /** Admin-facing caveats (e.g. a legacy SQL note whose host lives inside its DSN). */
      warnings: string[]
    }
  | { ok: false; error: string }

/** Every secret NAME a perimeter's env references — the set the runtime resolves. */
export function perimeterSecretRefs(perimeter: ConnectorPerimeter): string[] {
  const refs = Object.values(perimeter.env).flatMap(findSecretRefs)
  // The identity signing key and any OAuth client credentials resolve on the
  // SAME pass as env secrets, but are kept out of `env` afterwards — see
  // executeConnectorScript.
  if (perimeter.identity) refs.push(identitySecretName(perimeter.identity))
  if (perimeter.auth) refs.push(...authSecretRefs(perimeter.auth))
  return [...new Set(refs)]
}

function parseHostsList(raw: unknown): { ok: true; hosts: string[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, hosts: [] }
  if (!Array.isArray(raw)) return { ok: false, error: '`hosts` must be a list of host or host:port entries' }
  const hosts: string[] = []
  for (const entry of raw) {
    const value = typeof entry === 'string' ? entry.trim().toLowerCase().replace(/\.$/, '') : ''
    if (!value || findSecretRefs(value).length > 0 || !HOST_ENTRY_RE.test(value)) {
      return {
        ok: false,
        error: `Bad hosts entry ${JSON.stringify(entry)} — use a bare hostname like "api.stripe.com" or "db.internal:5432", written literally`,
      }
    }
    hosts.push(value)
  }
  return { ok: true, hosts }
}

function parsePerimeterEnv(raw: unknown): { ok: true; env: Record<string, string> } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, env: {} }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '`env` must map variable names to string values' }
  }
  const env: Record<string, string> = {}
  let bytes = 0
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!ENV_NAME_RE.test(key)) return { ok: false, error: `Bad env variable name '${key}'` }
    if (typeof value !== 'string') return { ok: false, error: `\`env.${key}\` must be a string` }
    bytes += key.length + value.length
    if (bytes > ENV_MAX_BYTES) return { ok: false, error: '`env` is too large' }
    for (const name of findSecretRefs(value)) {
      if (!isValidSecretName(name)) return { ok: false, error: `Invalid secret name '${name}' (use A-Z, 0-9 and _)` }
    }
    env[key] = value
  }
  return { ok: true, env }
}

/**
 * The `actions:` block — a map of name → { description?, params?, code }.
 *
 * Actions are the reviewable alternative to model-written JavaScript: an admin
 * writes the code once, in the note, and callers pick it by name with `args`.
 * The perimeter still applies unchanged — an action is convenience and review,
 * not a wider door. `params` is not validated against `args` at run time; it is
 * documentation for the caller, stored as written.
 */
function parseActions(
  raw: unknown,
): { ok: true; actions: Record<string, ConnectorAction> } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, actions: {} }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '`actions` must map action names to { description?, params?, code }' }
  }
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length > ACTION_LIMITS.maxActions) {
    return { ok: false, error: `Too many actions (max ${ACTION_LIMITS.maxActions})` }
  }
  const actions: Record<string, ConnectorAction> = {}
  for (const [name, value] of entries) {
    if (!ACTION_LIMITS.nameRe.test(name)) {
      return { ok: false, error: `Bad action name '${name}' — use lowercase letters, digits and _ (max 64 chars)` }
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { ok: false, error: `\`actions.${name}\` must be a map with a \`code\` string` }
    }
    const action = value as Record<string, unknown>
    if (typeof action.code !== 'string' || !action.code.trim()) {
      return { ok: false, error: `\`actions.${name}.code\` must be a non-empty JavaScript string` }
    }
    if (action.code.length > ACTION_LIMITS.maxCodeChars) {
      return { ok: false, error: `\`actions.${name}.code\` is too long (max ${ACTION_LIMITS.maxCodeChars} characters)` }
    }
    if (action.description !== undefined && action.description !== null && typeof action.description !== 'string') {
      return { ok: false, error: `\`actions.${name}.description\` must be a string` }
    }
    if (action.params !== undefined && action.params !== null && (typeof action.params !== 'object' || Array.isArray(action.params))) {
      return { ok: false, error: `\`actions.${name}.params\` must be an object` }
    }
    actions[name] = {
      description: typeof action.description === 'string' && action.description.trim() ? action.description.trim() : null,
      params: action.params === undefined ? null : action.params,
      code: action.code,
    }
  }
  return { ok: true, actions }
}

/** The v1 alias → v2 perimeter mapping — the back-compat shim, pure and testable. */
export function perimeterFromLegacy(config: ConnectorConfig): {
  perimeter: ConnectorPerimeter
  warnings: string[]
} {
  const env: Record<string, string> = {}
  for (const name of configSecretRefs(config)) env[name] = `{{secret:${name}}}`
  const timeoutMs = Math.max(config.timeoutMs, SANDBOX_LIMITS.timeoutMs.min)

  const hostOf = (raw: string): string => {
    const url = new URL(raw)
    return url.port ? `${url.hostname}:${url.port}` : url.hostname
  }

  switch (config.alias) {
    case 'http': {
      const hosts = [hostOf(config.baseUrl)]
      if (config.oauth) {
        const tokenHost = hostOf(config.oauth.tokenUrl)
        if (!hosts.includes(tokenHost)) hosts.push(tokenHost)
      }
      // v1 rules were relative to base_url; the proxy matches full request
      // paths, so a base_url with a path prefix must be folded into each rule.
      const prefix = new URL(config.baseUrl).pathname.replace(/\/$/, '')
      const allow = config.allow.map((rule) => ({ ...rule, path: prefix + rule.path }))
      return { perimeter: { hosts, allow, env, timeoutMs, identity: null, auth: null, actions: {}, webhook: null }, warnings: [] }
    }
    case 'postgres':
    case 'mysql':
      return {
        perimeter: { hosts: [], allow: [], env, timeoutMs, identity: null, auth: null, actions: {}, webhook: null },
        warnings: [
          `This legacy ${config.alias} note keeps its database host inside the DSN secret, so the ` +
            'perimeter cannot allow it — add `hosts:` (e.g. "db.example.com:5432") or run the v2 migration',
        ],
      }
    case 'mcp': {
      const warnings =
        config.allow.length > 0
          ? [
              'Legacy per-tool allow rules cannot be tunnel-enforced under v2 — they become guidance in the note body after migration',
            ]
          : []
      return { perimeter: { hosts: [hostOf(config.url)], allow: [], env, timeoutMs, identity: null, auth: null, actions: {}, webhook: null }, warnings }
    }
  }
}

/**
 * Frontmatter → perimeter, for v2 and legacy notes alike. Never throws; errors
 * are admin-readable. The v2 shape is anything that declares `hosts` or `env`;
 * a note with neither falls back to the legacy alias parser.
 */
export function parseConnectorPerimeter(fm: NoteFrontmatter): ParsePerimeterResult {
  // Presence decides, not well-formedness — a malformed `hosts:` must surface
  // its own error, not fall back to the legacy parser's unrelated one.
  const isV2 = fm.hosts !== undefined || fm.env !== undefined
  if (!isV2) {
    const legacy = parseConnectorConfig(fm)
    if (!legacy.ok) {
      return {
        ok: false,
        error:
          'Connector frontmatter needs `hosts:` (a list of hosts the run may reach; ' +
          '`hosts: []` for a no-network connector) — or a legacy `alias:` config: ' +
          legacy.error,
      }
    }
    const mapped = perimeterFromLegacy(legacy.config)
    return { ok: true, perimeter: mapped.perimeter, legacy: legacy.config.alias, warnings: mapped.warnings }
  }

  const hosts = parseHostsList(fm.hosts)
  if (!hosts.ok) return { ok: false, error: hosts.error }
  const env = parsePerimeterEnv(fm.env)
  if (!env.ok) return { ok: false, error: env.error }

  const allowRaw = Array.isArray(fm.allow) ? fm.allow : []
  const allow: AllowRule[] = []
  for (const entry of allowRaw) {
    const rule = typeof entry === 'string' ? parseAllowRule(entry) : null
    if (!rule) return { ok: false, error: `Bad allow entry ${JSON.stringify(entry)} — use "METHOD /path"` }
    allow.push(rule)
  }

  const identity = parseConnectorIdentity((fm as Record<string, unknown>).identity)
  if (!identity.ok) return { ok: false, error: identity.error }

  const auth = parseConnectorAuth((fm as Record<string, unknown>).auth)
  if (!auth.ok) return { ok: false, error: auth.error }

  const actions = parseActions((fm as Record<string, unknown>).actions)
  if (!actions.ok) return { ok: false, error: actions.error }

  const webhook = parseConnectorWebhook((fm as Record<string, unknown>).webhook)
  if (!webhook.ok) return { ok: false, error: webhook.error }

  const { min, max, default: dflt } = SANDBOX_LIMITS.timeoutMs
  return {
    ok: true,
    perimeter: {
      hosts: hosts.hosts,
      allow,
      env: env.env,
      timeoutMs: clamp(fm.timeout_ms, dflt, min, max),
      identity: identity.identity,
      auth: auth.auth,
      actions: actions.actions,
      webhook: webhook.webhook,
    },
    legacy: null,
    warnings: [],
  }
}
