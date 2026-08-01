/**
 * The connectors service — the only file that touches both the notes layer and
 * the secrets table. Deliberately MCP-free: not-found is `null`, everything
 * else is a ConnectorError, and the tool layer maps both onto McpError. All
 * note reads go through the brain visibility lens (readVisible/visibleVault),
 * so folder permissions govern who can even see a connector exists.
 */
import prisma from '@/lib/prisma'
import { decryptSecret } from '@/lib/crypto/secrets'
import { readVisible, visibleVault } from '@/lib/notes/brainService'
import { logAudit } from '@/lib/notes/audit'
import { parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import type { Brain } from '@/lib/notes/store'
import type { BrainPrincipal } from '@/lib/notes/shared/brainTypes'
import type { NoteFrontmatter } from '@/lib/notes/shared/types'
import { ConnectorError, findSecretRefs, parseConnectorConfig, type ConnectorConfig } from './config'

const CONNECTORS_DIR = 'connectors/'
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i
const DOCS_CAP_CHARS = 4_000

export interface ConnectorSummary {
  name: string
  path: string
  /** Raw frontmatter `alias` — loose, so a broken note still lists with its error. */
  alias: string | null
  description: string | null
  /** Human-readable allow entries; empty = documentation-only. */
  allow: string[]
  /** Parse failure, so admins (and agents) can see a broken connector. */
  invalid: string | null
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

/** Every valid-or-broken connector note the principal can see. */
export async function listConnectors(p: BrainPrincipal, brain: Brain): Promise<ConnectorSummary[]> {
  const { raws } = await visibleVault(p, brain)
  const summaries: ConnectorSummary[] = []
  for (const raw of raws) {
    if (!raw.path.startsWith(CONNECTORS_DIR) || !raw.path.endsWith('.md')) continue
    const fm = parseFrontmatter(raw.content)
    if (!isConnectorNote(fm)) continue
    const parsed = parseConnectorConfig(fm)
    const body = splitFrontmatter(raw.content).body.trim()
    summaries.push({
      name: connectorName(raw.path),
      path: raw.path,
      alias: typeof fm.alias === 'string' ? fm.alias : null,
      description: typeof fm.description === 'string' ? fm.description : null,
      allow:
        parsed.ok && parsed.config.alias === 'http'
          ? parsed.config.allow.map((r) => `${r.method} ${r.path}${r.prefix ? '*' : ''}`)
          : [],
      invalid: parsed.ok ? null : parsed.error,
      secrets: !parsed.ok
        ? []
        : parsed.config.alias === 'http'
          ? [...new Set(Object.values(parsed.config.headers).flatMap(findSecretRefs))]
          : findSecretRefs(parsed.config.dsn),
      docs: body.length > DOCS_CAP_CHARS ? body.slice(0, DOCS_CAP_CHARS) + '…' : body,
    })
  }
  return summaries.sort((a, b) => a.name.localeCompare(b.name))
}

export interface LoadedConnector {
  config: ConnectorConfig
  path: string
}

/**
 * Load one connector through the visibility lens. Null when the note is absent
 * OR not visible (indistinguishable, matching readVisible semantics); throws
 * ConnectorError('config') when the note exists but isn't a valid connector.
 */
export async function loadConnector(
  p: BrainPrincipal,
  brain: Brain,
  name: string,
): Promise<LoadedConnector | null> {
  if (!NAME_RE.test(name)) return null
  const path = `${CONNECTORS_DIR}${name}.md`
  const content = await readVisible(p, brain, path)
  if (content === null) return null
  const fm = parseFrontmatter(content)
  if (!isConnectorNote(fm)) {
    throw new ConnectorError('config', `The note at ${path} is not a connector (missing \`type: connector\`)`)
  }
  const parsed = parseConnectorConfig(fm)
  if (!parsed.ok) throw new ConnectorError('config', parsed.error)
  return { config: parsed.config, path }
}

/** Decrypt the named secrets for a community; every name must exist. */
export async function resolveSecretValues(
  communityId: string,
  names: readonly string[],
): Promise<Map<string, string>> {
  if (names.length === 0) return new Map()
  const rows = await prisma.communitySecret.findMany({
    where: { communityId, name: { in: [...names] } },
    select: { name: true, ciphertext: true },
  })
  const byName = new Map(rows.map((r) => [r.name, r.ciphertext]))
  const missing = names.filter((n) => !byName.has(n))
  if (missing.length > 0) {
    throw new ConnectorError(
      'missing_secret',
      `Secret${missing.length > 1 ? 's' : ''} ${missing.join(', ')} not set for this community — an admin must add ${missing.length > 1 ? 'them' : 'it'} on the connector's page`,
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

/** One audit line per connector execution, success or denial. */
export function auditConnectorCall(
  p: BrainPrincipal,
  path: string,
  detail: string,
): void {
  void logAudit(p.communityId, { userId: p.userId, name: p.name, action: 'connector', path, detail })
}
