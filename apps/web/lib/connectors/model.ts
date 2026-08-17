/**
 * Model connectors — the `kind: model` connector variant.
 *
 * A model connector is a note at `connectors/<name>.md` that stands for an LLM
 * provider the Space's agents run on (Gemini, OpenAI, Anthropic, or the
 * admin-set custom endpoint). It sits beside HTTP connectors in the connectors
 * list and its key lives in the same encrypted secrets table, so "everything
 * this Space reaches out to, and the keys it uses" has one home. Two things
 * deliberately make it NOT an ordinary connector:
 *
 *   • It is never runnable. `run_connector` (MCP, agent tool, console) hands
 *     caller-authored JS the plaintext of every secret its perimeter binds, so
 *     an ordinary connector holding a model key would let any member with
 *     `connectors:use` exfiltrate it or spend it. A model connector has no
 *     perimeter; {@link loadConnector} refuses it before anything can run.
 *   • Its base URL comes from {@link PROVIDERS} (pinned in code, exactly like
 *     an HTTP connector's `hosts:` are written literally), never from the note.
 *     `custom` resolves to the admin-only `Space.agentConfig.customEndpoint`.
 *
 * Frontmatter:
 *   type: connector
 *   kind: model
 *   provider: gemini | openai | anthropic | custom
 *   description: …          (optional)
 *
 * The key is `MODEL_KEY_<PROVIDER>` — fixed by the provider, one per Space —
 * so two model connectors for the same provider share a key. That is on
 * purpose: the key is the Space's, the note is how it appears in the console.
 * Pure module: no prisma, no fetch.
 */
import type { NoteFrontmatter } from '@/lib/notes/shared/types'
import { PROVIDERS, type ProviderEntry } from '@/lib/agents/registry'

export type ConnectorKind = 'http' | 'model'

/** The `kind:` a connector note declares; anything but `model` is an HTTP (perimeter) connector. */
export function connectorKind(fm: NoteFrontmatter): ConnectorKind {
  return typeof fm.kind === 'string' && fm.kind.trim().toLowerCase() === 'model' ? 'model' : 'http'
}

export interface ModelConnectorConfig {
  provider: ProviderEntry
}

export type ParseModelConnectorResult =
  | { ok: true; config: ModelConnectorConfig }
  | { ok: false; error: string }

/** Frontmatter → model connector config. Never throws; errors are admin-readable. */
export function parseModelConnector(fm: NoteFrontmatter): ParseModelConnectorResult {
  const raw = typeof fm.provider === 'string' ? fm.provider.trim().toLowerCase() : ''
  if (!raw) {
    return {
      ok: false,
      error: `A model connector needs \`provider:\` — one of ${PROVIDERS.map((p) => p.id).join(', ')}`,
    }
  }
  const provider = PROVIDERS.find((p) => p.id === raw)
  if (!provider) {
    return { ok: false, error: `unknown model provider "${raw}" — one of ${PROVIDERS.map((p) => p.id).join(', ')}` }
  }
  for (const key of ['hosts', 'env', 'allow', 'base_url', 'url'] as const) {
    if (fm[key] !== undefined) {
      return {
        ok: false,
        error: `A model connector must not declare \`${key}:\` — its endpoint is pinned by the provider (${provider.label}) and its key is the ${provider.keySecret} secret`,
      }
    }
  }
  return { ok: true, config: { provider } }
}

/** What a model connector exposes to the list/detail surfaces — never the key. */
export interface ModelConnectorInfo {
  provider: string
  providerLabel: string
  /** Null for `custom` (an admin-only Space setting) — the UI says so. */
  baseURL: string | null
  keySecret: string
  models: { id: string; label: string }[]
}

export function modelConnectorInfo(config: ModelConnectorConfig): ModelConnectorInfo {
  const p = config.provider
  return {
    provider: p.id,
    providerLabel: p.label,
    baseURL: p.baseURL,
    keySecret: p.keySecret,
    models: p.models.map((m) => ({ id: m.id, label: m.label })),
  }
}

/**
 * The starting note for a model connector created from the Create panel.
 * Round-trips through {@link parseModelConnector}.
 */
export function newModelConnectorNote(input: { name: string; provider: string; description?: string }): string {
  const provider = PROVIDERS.find((p) => p.id === input.provider.trim().toLowerCase())
  if (!provider) throw new Error(`unknown model provider "${input.provider}"`)
  const description = (input.description ?? '').trim()
  const front = [
    `type: connector`,
    `kind: model`,
    `title: ${JSON.stringify(input.name)}`,
    `alias: model`,
    `provider: ${provider.id}`,
  ]
  if (description) front.push(`description: ${JSON.stringify(description)}`)
  const body = [
    description || `${provider.label} — a model provider this space's agents can run on.`,
    ``,
    provider.baseURL
      ? `Requests go to ${provider.baseURL} (pinned by Visvine, not by this note).`
      : `Requests go to the custom endpoint an admin sets in the space's agent settings.`,
    `The key is the ${provider.keySecret} secret, set on this connector's page and`,
    `never written into a note. Agents pick a model with`,
    provider.models.length > 0
      ? `\`model: ${provider.id}/${provider.models[0].id}\` in their brief.`
      : `\`model: ${provider.id}/<model-id>\` in their brief.`,
    ``,
    `This connector is not runnable — \`run_connector\` refuses it, so no note`,
    `or agent can read or spend the key directly.`,
  ]
  return `---\n${front.join('\n')}\n---\n\n${body.join('\n')}\n`
}
