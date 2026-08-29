/**
 * Model connectors — the `kind: model` connector variant.
 *
 * A model connector is a note at `connectors/<name>.md` that stands for an LLM
 * provider the Space's agents run on (Gemini, OpenAI, Anthropic, OpenRouter, or
 * a custom OpenAI-compatible endpoint). It sits beside HTTP connectors in the
 * connectors list and its key lives in the same encrypted secrets table, so "everything
 * this Space reaches out to, and the keys it uses" has one home — the
 * connectors folder — and nothing model-related lives anywhere else. Two things
 * deliberately make it NOT an ordinary connector:
 *
 *   • It is never runnable. `run_connector` (MCP, agent tool, console) hands
 *     caller-authored JS the plaintext of every secret its perimeter binds, so
 *     an ordinary connector holding a model key would let any member with
 *     `connectors:use` exfiltrate it or spend it. A model connector has no
 *     perimeter; {@link loadConnector} refuses it before anything can run.
 *   • Its base URL is admin-controlled. Registry providers pin it in code
 *     ({@link PROVIDERS}); `custom` reads it from the note's `base_url:` — and
 *     that is safe for the same reason an HTTP connector's `hosts:` is: the
 *     `connectors/` folder is admin-only for writes regardless of grants, so a
 *     member-writable brief can never point the Space's context at a host of
 *     its choosing. The URL is shape-checked here (pure) and SSRF-checked at
 *     save and at resolve time, before any request leaves.
 *
 * Frontmatter:
 *   type: connector
 *   kind: model
 *   provider: gemini | openai | anthropic | openrouter | custom
 *   base_url: https://…      (custom only, required; refused on the others)
 *   description: …           (optional)
 *
 * The key is `MODEL_KEY_<PROVIDER>` — fixed by the provider, one per Space —
 * so two model connectors for the same provider share a key. That is on
 * purpose: the key is the Space's, the note is how it appears in the console.
 * Pure module: no prisma, no fetch.
 */
import type { NoteFrontmatter } from '@/lib/notes/shared/types'
import { PROVIDERS, type ModelPricing, type ProviderEntry } from '@/lib/agents/registry'

export type ConnectorKind = 'http' | 'model'

/** The `kind:` a connector note declares; anything but `model` is an HTTP (perimeter) connector. */
export function connectorKind(fm: NoteFrontmatter): ConnectorKind {
  return typeof fm.kind === 'string' && fm.kind.trim().toLowerCase() === 'model' ? 'model' : 'http'
}

export interface ModelConnectorConfig {
  provider: ProviderEntry
  /** Where requests go: the registry's pinned URL, or the note's `base_url:` for `custom`. */
  baseURL: string
  /**
   * What the endpoint charges, per model id, in USD per million tokens.
   *
   * Registry providers carry their own prices in code. A custom endpoint cannot
   * — nobody but the admin knows what their gateway bills — so without this a
   * space's monthly cap has nothing to compare against and never binds. Prices
   * are declared, not discovered: a wrong number here means a wrong cap, which
   * is why the run's token backstop (lib/agents/budget.ts) does not depend on
   * it.
   */
  pricing: Readonly<Record<string, ModelPricing>>
}

export type ParseModelConnectorResult =
  | { ok: true; config: ModelConnectorConfig }
  | { ok: false; error: string }

/**
 * Shape-check a custom endpoint: absolute, https (http only in development,
 * for a local model server), no query/fragment, no template. Normalised to a
 * trailing slash so `${base}chat/completions` composes. Routability (SSRF) is
 * a DNS question and lives in lib/agents/providers.ts.
 */
export function parseModelBaseUrl(raw: unknown): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: 'A custom model connector needs `base_url:` — an OpenAI-compatible https URL' }
  const value = raw.trim()
  if (value.includes('{{')) return { ok: false, error: '`base_url:` must be literal — it cannot reference a secret' }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { ok: false, error: '`base_url:` must be an absolute URL' }
  }
  const devHttp = url.protocol === 'http:' && process.env.NODE_ENV === 'development'
  if (url.protocol !== 'https:' && !devHttp) return { ok: false, error: '`base_url:` must use https' }
  if (url.search || url.hash) return { ok: false, error: '`base_url:` must not carry a query or fragment' }
  const text = url.toString()
  return { ok: true, url: text.endsWith('/') ? text : `${text}/` }
}

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
  for (const key of ['hosts', 'env', 'allow', 'url'] as const) {
    if (fm[key] !== undefined) {
      return {
        ok: false,
        error: `A model connector must not declare \`${key}:\` — it has no perimeter; its key is the ${provider.keySecret} secret`,
      }
    }
  }
  const pricing = parseModelPricing(fm.pricing)
  if (!pricing.ok) return pricing

  if (provider.baseURL) {
    if (fm.base_url !== undefined) {
      return {
        ok: false,
        error: `A ${provider.label} connector must not declare \`base_url:\` — its endpoint is pinned by Visvine. Use \`provider: custom\` for your own endpoint`,
      }
    }
    return { ok: true, config: { provider, baseURL: provider.baseURL, pricing: pricing.pricing } }
  }
  const base = parseModelBaseUrl(fm.base_url)
  if (!base.ok) return base
  return { ok: true, config: { provider, baseURL: base.url, pricing: pricing.pricing } }
}

/**
 * `pricing:` — a map of model id to USD per million tokens:
 *
 *     pricing:
 *       z-ai/glm-5.3-flash: { input_per_m: 0.05, output_per_m: 0.2 }
 *
 * Optional, and refused rather than coerced when malformed: a price the parser
 * guessed at would produce a cap nobody can predict.
 */
export function parseModelPricing(
  raw: unknown,
): { ok: true; pricing: Record<string, ModelPricing> } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, pricing: {} }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '`pricing:` must be a map of model id to { input_per_m, output_per_m }' }
  }
  const out: Record<string, ModelPricing> = {}
  for (const [modelId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { ok: false, error: `\`pricing.${modelId}\` must be { input_per_m, output_per_m }` }
    }
    const entry = value as Record<string, unknown>
    const input = entry.input_per_m
    const output = entry.output_per_m
    if (!isPrice(input) || !isPrice(output)) {
      return { ok: false, error: `\`pricing.${modelId}\` needs numeric input_per_m and output_per_m (USD per million tokens)` }
    }
    out[modelId] = { inputPerM: input, outputPerM: output }
  }
  return { ok: true, pricing: out }
}

function isPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** What a model connector exposes to the list/detail surfaces — never the key. */
export interface ModelConnectorInfo {
  provider: string
  providerLabel: string
  baseURL: string
  /** True when `base_url:` is the note's own (custom) rather than pinned by the registry. */
  customEndpoint: boolean
  keySecret: string
  models: { id: string; label: string }[]
}

export function modelConnectorInfo(config: ModelConnectorConfig): ModelConnectorInfo {
  const p = config.provider
  return {
    provider: p.id,
    providerLabel: p.label,
    baseURL: config.baseURL,
    customEndpoint: p.baseURL === null,
    keySecret: p.keySecret,
    models: p.models.map((m) => ({ id: m.id, label: m.label })),
  }
}

/**
 * The starting note for a model connector created from the Create panel.
 * Round-trips through {@link parseModelConnector}.
 */
export function newModelConnectorNote(input: {
  name: string
  provider: string
  baseUrl?: string
  description?: string
  /** The catalog recipe this came from — display only (lib/connectors/catalog.ts). */
  recipe?: string
}): string {
  const provider = PROVIDERS.find((p) => p.id === input.provider.trim().toLowerCase())
  if (!provider) throw new Error(`unknown model provider "${input.provider}"`)
  let baseURL = provider.baseURL
  if (!baseURL) {
    const parsed = parseModelBaseUrl(input.baseUrl)
    if (!parsed.ok) throw new Error(parsed.error)
    baseURL = parsed.url
  }
  const description = (input.description ?? '').trim()
  const front = [
    `type: connector`,
    `kind: model`,
    `title: ${JSON.stringify(input.name)}`,
    `alias: model`,
    `provider: ${provider.id}`,
  ]
  if (input.recipe) front.push(`recipe: ${input.recipe}`)
  if (!provider.baseURL) front.push(`base_url: ${baseURL}`)
  if (description) front.push(`description: ${JSON.stringify(description)}`)
  const body = [
    description || `${provider.label} — a model provider this space's agents can run on.`,
    ``,
    provider.baseURL
      ? `Requests go to ${provider.baseURL} (pinned by Visvine, not by this note).`
      : `Requests go to ${baseURL} — the \`base_url:\` above, which only an admin can change.`,
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
