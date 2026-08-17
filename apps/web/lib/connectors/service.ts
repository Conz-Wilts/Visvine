/**
 * The connectors service — the only file that touches the notes layer, the
 * secrets table AND the isolate runtime. Deliberately MCP-free: not-found is
 * `null`, everything else is a ConnectorError, and the tool layer maps both
 * onto McpError. All note reads go through the context visibility lens
 * (readVisible/visibleVault), so folder permissions govern who can even see a
 * connector exists.
 *
 * Execution is one path for everyone: {@link executeConnectorScript} is what
 * an agent's run_connector calls and what the console's terminal calls — same
 * perimeter, same secrets, same audit line. There is no thinner admin path.
 */
import prisma from '@/lib/prisma'
import { decryptSecret } from '@/lib/crypto/secrets'
import { readVisible, visibleVault } from '@/lib/notes/contextService'
import { listAudit, logAudit } from '@/lib/notes/audit'
import { parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import type { Context } from '@/lib/notes/store'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { NoteFrontmatter } from '@/lib/notes/shared/types'
import {
  allowPrivateHosts,
  ConnectorError,
  interpolateSecrets,
  parseConnectorPerimeter,
  perimeterSecretRefs,
  type ConnectorPerimeter,
} from './config'
import { runInIsolate, type IsolateRunResult } from './isolate'
import { connectorKind, modelConnectorInfo, parseModelConnector, type ConnectorKind, type ModelConnectorInfo } from './model'

const CONNECTORS_DIR = 'connectors/'
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i
const DOCS_CAP_CHARS = 4_000

export interface ConnectorSummary {
  name: string
  path: string
  /** `http` = a perimeter connector agents can run; `model` = an LLM provider (never runnable). */
  kind: ConnectorKind
  /** Set for `kind: model` — provider, pinned base URL, key secret NAME, known models. */
  model: ModelConnectorInfo | null
  /** Raw frontmatter `alias` — display metadata only (chip colour), any string. */
  alias: string | null
  description: string | null
  /** Hosts the run may reach; empty = no network (documentation-only connector). */
  hosts: string[]
  /** Human-readable method+path rules; empty = host-gated only. */
  allow: string[]
  /** Parse failure, so admins (and agents) can see a broken connector. */
  invalid: string | null
  /** Caveats worth surfacing (mostly legacy notes the migration hasn't rewritten). */
  warnings: string[]
  /** Secret NAMES this connector references — never values. */
  secrets: string[]
  docs: string
}

function connectorName(path: string): string {
  return path.slice(CONNECTORS_DIR.length).replace(/\.md$/, '')
}

/**
 * Is this note's frontmatter marked `type: connector`? Case-insensitive: every
 * other entity namespace writes its `type:` capitalised (`Person`, `Space`), so
 * a note authored by hand as `type: Connector` must count.
 */
function isConnectorNote(fm: NoteFrontmatter): boolean {
  return typeof fm.type === 'string' && fm.type.trim().toLowerCase() === 'connector'
}

/** Human-readable form of an allow rule — the shape admins wrote in the note. */
function formatAllowRule(rule: { method: string; path: string; prefix: boolean }): string {
  return `${rule.method} ${rule.path}${rule.prefix ? '*' : ''}`
}

/** One connector note → its summary, or null when the note isn't a connector. */
function summariseNote(path: string, content: string): ConnectorSummary | null {
  const fm = parseFrontmatter(content)
  if (!isConnectorNote(fm)) return null
  const body = splitFrontmatter(content).body.trim()
  const docs = body.length > DOCS_CAP_CHARS ? body.slice(0, DOCS_CAP_CHARS) + '…' : body
  const base = {
    name: connectorName(path),
    path,
    alias: typeof fm.alias === 'string' ? fm.alias : null,
    description: typeof fm.description === 'string' ? fm.description : null,
    docs,
  }
  if (connectorKind(fm) === 'model') {
    // No perimeter: the endpoint is the provider's, the key is the provider's
    // reserved secret. `secrets` names it so the console's missing-secret
    // check works unchanged.
    const parsed = parseModelConnector(fm)
    const info = parsed.ok ? modelConnectorInfo(parsed.config) : null
    return {
      ...base,
      kind: 'model',
      model: info,
      hosts: [],
      allow: [],
      invalid: parsed.ok ? null : parsed.error,
      warnings: [],
      secrets: info ? [info.keySecret] : [],
    }
  }
  const parsed = parseConnectorPerimeter(fm)
  return {
    ...base,
    kind: 'http',
    model: null,
    description: typeof fm.description === 'string' ? fm.description : null,
    hosts: parsed.ok ? [...parsed.perimeter.hosts] : [],
    allow: parsed.ok ? parsed.perimeter.allow.map(formatAllowRule) : [],
    invalid: parsed.ok ? null : parsed.error,
    warnings: parsed.ok ? parsed.warnings : [],
    secrets: parsed.ok ? perimeterSecretRefs(parsed.perimeter) : [],
  }
}

/** Every valid-or-broken connector note the principal can see. */
export async function listConnectors(p: ContextPrincipal, context: Context): Promise<ConnectorSummary[]> {
  const { raws } = await visibleVault(p, context)
  const summaries: ConnectorSummary[] = []
  for (const raw of raws) {
    if (!raw.path.startsWith(CONNECTORS_DIR) || !raw.path.endsWith('.md')) continue
    const summary = summariseNote(raw.path, raw.content)
    if (summary) summaries.push(summary)
  }
  return summaries.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * One connector, in the detail the console's Connector tab renders: the summary
 * every caller gets, plus the parsed perimeter and its env templates. `perimeter`
 * is null exactly when `invalid` is set — a broken note still describes itself
 * so an admin can see what to fix.
 *
 * Null (rather than an error) when the note is absent, invisible to this
 * principal, or isn't a connector at all — the same indistinguishable
 * not-found readVisible gives, so a page can 404 uniformly.
 */
export interface ConnectorDetail extends ConnectorSummary {
  perimeter: ConnectorPerimeter | null
}

export async function describeConnector(
  p: ContextPrincipal,
  context: Context,
  name: string,
): Promise<ConnectorDetail | null> {
  if (!NAME_RE.test(name)) return null
  const path = `${CONNECTORS_DIR}${name}.md`
  const content = await readVisible(p, context, path)
  if (content === null) return null
  const summary = summariseNote(path, content)
  if (!summary) return null
  if (summary.kind === 'model') return { ...summary, perimeter: null }
  const parsed = parseConnectorPerimeter(parseFrontmatter(content))
  return { ...summary, perimeter: parsed.ok ? parsed.perimeter : null }
}

/** One past run of a connector, as the audit trail recorded it. */
export interface ConnectorCall {
  at: number
  /** Who asked — the principal's display name, agent or admin alike. */
  by: string
  /** The code that ran, truncated at write time to AUDIT_CODE_CHARS. */
  code: string
  /** What came back: `ok`, `timeout`, `error: …`, `missing_secret: …`. */
  outcome: string
}

/**
 * A connector's call history, newest first. Every execution audits itself
 * (see {@link executeConnectorScript}), so this is a read of that trail
 * narrowed to one connector rather than a second record to keep in step.
 *
 * The stored detail is `run [code] → outcome`; the split is here so the
 * shape callers see survives a change to that wording.
 */
export async function listConnectorCalls(
  spaceId: string,
  path: string,
  limit = 25,
): Promise<ConnectorCall[]> {
  const entries = await listAudit(spaceId)
  const calls: ConnectorCall[] = []
  for (const entry of entries) {
    if (entry.action !== 'connector' || entry.path !== path) continue
    const match = /^run \[([^]*)\] → ([^]*)$/.exec(entry.detail ?? '')
    calls.push({
      at: entry.at,
      by: entry.name,
      code: match?.[1] ?? '',
      outcome: match?.[2] ?? (entry.detail ?? ''),
    })
    if (calls.length >= limit) break
  }
  return calls
}

export interface LoadedConnector {
  perimeter: ConnectorPerimeter
  path: string
  warnings: string[]
}

/**
 * Load one connector through the visibility lens. Null when the note is absent
 * OR not visible (indistinguishable, matching readVisible semantics); throws
 * ConnectorError('config') when the note exists but isn't a valid connector —
 * including every `kind: model` connector, which is deliberately not runnable
 * (see lib/connectors/model.ts). Every executor (MCP run_connector, the agent
 * tool, the console terminal) loads through here, so that refusal is one line.
 */
export async function loadConnector(
  p: ContextPrincipal,
  context: Context,
  name: string,
): Promise<LoadedConnector | null> {
  if (!NAME_RE.test(name)) return null
  const path = `${CONNECTORS_DIR}${name}.md`
  const content = await readVisible(p, context, path)
  if (content === null) return null
  const fm = parseFrontmatter(content)
  if (!isConnectorNote(fm)) {
    throw new ConnectorError('config', `The note at ${path} is not a connector (missing \`type: connector\`)`)
  }
  if (connectorKind(fm) === 'model') {
    throw new ConnectorError(
      'config',
      `${name} is a model connector — it names the provider agents run on and is not runnable. Set an agent's \`model:\` to use it.`,
    )
  }
  const parsed = parseConnectorPerimeter(fm)
  if (!parsed.ok) throw new ConnectorError('config', parsed.error)
  return { perimeter: parsed.perimeter, path, warnings: parsed.warnings }
}

/**
 * Which of these declared connector names an agent may actually be offered a
 * `run_connector` tool for: everything except `kind: model` notes. Absent or
 * invisible names stay in the list — the tool then reports not-found at call
 * time, which is the honest answer; only model connectors are silently
 * unofferable, because offering them would advertise something that always
 * refuses.
 */
export async function runnableConnectorNames(
  p: ContextPrincipal,
  context: Context,
  names: readonly string[],
): Promise<string[]> {
  const out: string[] = []
  for (const name of names) {
    if (!NAME_RE.test(name)) continue
    const content = await readVisible(p, context, `${CONNECTORS_DIR}${name}.md`)
    if (content !== null && connectorKind(parseFrontmatter(content)) === 'model') continue
    out.push(name)
  }
  return out
}

/** Decrypt the named secrets for a space; every name must exist. */
async function resolveSecretValues(
  spaceId: string,
  names: readonly string[],
): Promise<Map<string, string>> {
  if (names.length === 0) return new Map()
  const rows = await prisma.connectorSecret.findMany({
    where: { spaceId, name: { in: [...names] } },
    select: { name: true, ciphertext: true },
  })
  const byName = new Map(rows.map((r) => [r.name, r.ciphertext]))
  const missing = names.filter((n) => !byName.has(n))
  if (missing.length > 0) {
    throw new ConnectorError(
      'missing_secret',
      `Secret${missing.length > 1 ? 's' : ''} ${missing.join(', ')} not set for this space — an admin must add ${missing.length > 1 ? 'them' : 'it'} on the connector's page`,
    )
  }
  const values = new Map<string, string>()
  for (const [name, ciphertext] of byName) {
    try {
      values.set(name, decryptSecret(ciphertext))
    } catch (e) {
      // SECRETS_KEY unset/rotated or a corrupt row — never leak the detail.
      const misconfigured = e instanceof Error && e.message.includes('SECRETS_KEY')
      throw new ConnectorError(
        'config',
        misconfigured
          ? 'Connector secrets are not configured on this server'
          : `Stored secret ${name} cannot be decrypted — it may need to be set again`,
      )
    }
  }
  return values
}

// JavaScript says the same thing as a shell pipeline in more characters, so
// the v2 command cap would now bite on ordinary connector code.
const CODE_MAX_CHARS = 32_768
const AUDIT_CODE_CHARS = 200

/**
 * Run one connector script inside its perimeter — the whole execution path,
 * shared by the agent tool and the console terminal: secrets resolve
 * server-side into the isolate's `env`, the isolate's only egress is the
 * capability functions gated on the note's hosts, secret values are redacted
 * from everything that comes back, and the run is audited win or lose.
 */
export async function executeConnectorScript(
  p: ContextPrincipal,
  context: Context,
  spaceId: string,
  loaded: LoadedConnector,
  code: string,
): Promise<IsolateRunResult> {
  if (!code.trim()) throw new ConnectorError('config', 'Nothing to run — pass JavaScript to evaluate')
  if (code.length > CODE_MAX_CHARS) {
    throw new ConnectorError('config', `Script too long (max ${CODE_MAX_CHARS} characters)`)
  }

  const summary = code.slice(0, AUDIT_CODE_CHARS).replace(/\s+/g, ' ').trim()
  try {
    const secrets = await resolveSecretValues(spaceId, perimeterSecretRefs(loaded.perimeter))
    const env: Record<string, string> = {}
    for (const [key, template] of Object.entries(loaded.perimeter.env)) {
      const resolved = interpolateSecrets(template, secrets)
      if (!resolved.ok) {
        throw new ConnectorError('missing_secret', `Secret ${resolved.missing.join(', ')} not set`)
      }
      env[key] = resolved.value
    }

    const result = await runInIsolate(
      { ...loaded.perimeter, env, allowPrivate: allowPrivateHosts() },
      code,
      { redact: [...secrets.values()] },
    )
    auditConnectorCall(
      p,
      loaded.path,
      `run [${summary}] → ${
        result.timedOut ? 'timeout' : result.ok ? 'ok' : `error: ${result.error?.message ?? 'unknown'}`
      }${result.denials.length > 0 ? `, ${result.denials.length} egress denial(s)` : ''}`,
    )
    return result
  } catch (e) {
    if (e instanceof ConnectorError) {
      auditConnectorCall(p, loaded.path, `run [${summary}] → ${e.code}: ${e.message}`)
    }
    throw e
  }
}

/** One audit line per connector execution, success or denial. */
function auditConnectorCall(
  p: ContextPrincipal,
  path: string,
  detail: string,
): void {
  void logAudit(p.spaceId, { userId: p.userId, name: p.name, action: 'connector', path, detail })
}
