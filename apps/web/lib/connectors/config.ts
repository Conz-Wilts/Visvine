/**
 * Connector configuration — the pure half of the connectors feature.
 *
 * A connector is a note at `connectors/<name>.md` whose frontmatter is machine
 * config and whose body is agent-facing docs. This module turns frontmatter
 * into a validated ConnectorConfig and hosts the security-critical string
 * logic: the allowlist grammar, `{{secret:NAME}}` reference handling, and
 * output redaction. No I/O lives here — everything is unit-testable.
 *
 * `alias` (http | postgres) picks the executor. It's called an alias, not a
 * kind, because it IS the node alias: a connector note syncs a `connector:`
 * node whose `Node.alias` mirrors this field, so the same value that routes the
 * call also colours the chip in the directory (see DEFAULT_ALIASES in
 * lib/types/context.ts).
 *
 * Two invariants the executors rely on:
 *   • Secret VALUES never appear in config — only `{{secret:NAME}}` references.
 *     A postgres `dsn` must be exactly one reference; an http `base_url` may
 *     not contain any (the host the SSRF check judges must be the host the
 *     admin actually wrote).
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

export interface HttpConnectorConfig {
  alias: 'http'
  baseUrl: string
  allow: AllowRule[]
  headers: Record<string, string>
  timeoutMs: number
}

export interface PostgresConnectorConfig {
  alias: 'postgres'
  /** Always a single `{{secret:NAME}}` reference, never a raw DSN. */
  dsn: string
  maxRows: number
  timeoutMs: number
}

export type ConnectorConfig = HttpConnectorConfig | PostgresConnectorConfig

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

/** Frontmatter → validated config. Never throws; errors are admin-readable. */
export function parseConnectorConfig(fm: NoteFrontmatter): ParseConfigResult {
  const alias = fm.alias
  if (alias !== 'http' && alias !== 'postgres') {
    return { ok: false, error: "Connector frontmatter needs `alias: http` or `alias: postgres`" }
  }
  const timeoutMs = clamp(fm.timeout_ms, TIMEOUT_DEFAULT_MS, TIMEOUT_MIN_MS, TIMEOUT_MAX_MS)

  if (alias === 'postgres') {
    const dsn = typeof fm.dsn === 'string' ? fm.dsn.trim() : ''
    const refs = findSecretRefs(dsn)
    if (refs.length !== 1 || !dsn.match(SECRET_REF_RE) || dsn.replace(SECRET_REF_RE, '') !== '') {
      return {
        ok: false,
        error:
          'A postgres connector `dsn` must be exactly one secret reference like ' +
          '"{{secret:ANALYTICS_DSN}}" — raw connection strings are not allowed in notes',
      }
    }
    if (!isValidSecretName(refs[0])) {
      return { ok: false, error: `Invalid secret name '${refs[0]}' (use A-Z, 0-9 and _)` }
    }
    return {
      ok: true,
      config: {
        alias: 'postgres',
        dsn,
        maxRows: clamp(fm.max_rows, MAX_ROWS_DEFAULT, 1, MAX_ROWS_MAX),
        timeoutMs,
      },
    }
  }

  const baseUrl = typeof fm.base_url === 'string' ? fm.base_url.trim() : ''
  if (findSecretRefs(baseUrl).length > 0) {
    return { ok: false, error: '`base_url` may not contain secret references — put them in `headers`' }
  }
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return { ok: false, error: 'An http connector needs a valid absolute `base_url`' }
  }
  const httpsOk = url.protocol === 'https:'
  const devHttpOk = url.protocol === 'http:' && process.env.NODE_ENV === 'development'
  if (!httpsOk && !devHttpOk) {
    return { ok: false, error: '`base_url` must be https' }
  }
  if (url.search || url.hash) {
    return { ok: false, error: '`base_url` may not include a query string or fragment' }
  }

  const headers = parseHeaders(fm.headers)
  if (headers === null) {
    return { ok: false, error: '`headers` must map header names to string values' }
  }
  for (const name of Object.values(headers).flatMap(findSecretRefs)) {
    if (!isValidSecretName(name)) {
      return { ok: false, error: `Invalid secret name '${name}' (use A-Z, 0-9 and _)` }
    }
  }

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
    config: { alias: 'http', baseUrl: baseUrl.replace(/\/+$/, ''), allow, headers, timeoutMs },
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
  alias: 'http' | 'postgres'
  description?: string
  /** http only. */
  baseUrl?: string
  /** http only — already-split "METHOD /path" rules. */
  allow?: readonly string[]
  /** postgres only — the secret NAME holding the DSN. */
  secretName?: string
}): string {
  const description = (input.description ?? '').trim()
  const front = [`type: connector`, `alias: ${input.alias}`, `title: ${JSON.stringify(input.name)}`]
  if (description) front.push(`description: ${JSON.stringify(description)}`)

  if (input.alias === 'postgres') {
    front.push(`dsn: "{{secret:${(input.secretName ?? '').trim().toUpperCase()}}}"`)
    front.push(`max_rows: ${MAX_ROWS_DEFAULT}`)
  } else {
    front.push(`base_url: ${(input.baseUrl ?? '').trim().replace(/\/+$/, '')}`)
    const allow = (input.allow ?? []).map((r) => r.trim()).filter(Boolean)
    front.push(
      allow.length > 0
        ? `allow:\n${allow.map((r) => `  - ${JSON.stringify(r)}`).join('\n')}`
        : `allow: []`,
    )
  }
  front.push(`timeout_ms: ${TIMEOUT_DEFAULT_MS}`)

  const body =
    input.alias === 'postgres'
      ? [
          `${description || `The ${input.name} database.`}`,
          ``,
          `Queries run read-only inside a transaction, one statement at a time, capped at`,
          `${MAX_ROWS_DEFAULT} rows. Describe the tables an agent should know about here.`,
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
