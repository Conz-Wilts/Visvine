/**
 * The model provider registry for Space agents.
 *
 * An agent's brief names its model as `<provider>/<modelId>` (e.g.
 * `gemini/gemma-4-31b-it`). The provider half resolves against THIS registry,
 * whose base URLs are pinned literally in code — exactly as connector `hosts:`
 * are — because the brief is member-writable and an open URL there would let
 * any member POST the Space's whole context to a host of their choosing.
 * `custom/<modelId>` is the one escape hatch: its base URL is the `base_url:`
 * of the Space's `provider: custom` model connector — a note in `connectors/`,
 * which is admin-only for writes (lib/connectors/model.ts).
 *
 * The key is the Space's own, stored in ConnectorSecret under a reserved name
 * per provider (`MODEL_KEY_GEMINI`, …), so it is encrypted, admin-only and
 * write-only like every other secret. Visvine never bills a Space for tokens.
 *
 * Every provider speaks the OpenAI-compatible chat/completions wire format,
 * which is what lib/notes/ai.ts already talks — the model is a per-agent
 * choice, not a platform dependency.
 */

// Pure module: no prisma, no fetch — parsers and tests import it. These two
// literals mirror lib/notes/ai.ts (which can't be imported here without
// dragging the note store in).
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/'
const DEFAULT_GEMINI_MODEL = 'gemma-4-31b-it'

/**
 * USD per one million tokens. `cachedInputPerM` is the discounted rate for
 * cache-read input tokens; when absent they bill at `inputPerM` (conservative:
 * the cap over-counts rather than under-counts).
 */
export interface ModelPricing {
  inputPerM: number
  outputPerM: number
  cachedInputPerM?: number
}

interface RegistryModel {
  id: string
  label: string
  /** Null = unknown; runs still meter tokens but report no dollar cost. */
  pricing: ModelPricing | null
}

export interface ProviderEntry {
  id: string
  label: string
  /** Pinned literally. `null` for `custom`, whose URL is its model connector's `base_url:`. */
  baseURL: string | null
  /** The ConnectorSecret name holding this provider's key. */
  keySecret: string
  /** Where to GET a cheap probe that proves the key works (relative to baseURL). */
  probePath: string | null
  /** Known models. Unknown ids under a known provider are allowed (pass-through, no pricing). */
  models: RegistryModel[]
}

const MODEL_KEY_PREFIX = 'MODEL_KEY_'

// Anthropic model ids and list prices per the claude-api skill (2026-06):
// Opus 5 $5/$25, Sonnet 5 $3/$15, Haiku 4.5 $1/$5. Reached through Anthropic's
// OpenAI-compatible surface so it rides the same code path as every provider.
export const PROVIDERS: readonly ProviderEntry[] = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseURL: GEMINI_BASE_URL,
    keySecret: `${MODEL_KEY_PREFIX}GEMINI`,
    probePath: 'models',
    models: [
      { id: DEFAULT_GEMINI_MODEL, label: 'Gemma 4 31B', pricing: null },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', pricing: { inputPerM: 0.3, outputPerM: 2.5 } },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', pricing: { inputPerM: 1.25, outputPerM: 10 } },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1/',
    keySecret: `${MODEL_KEY_PREFIX}OPENAI`,
    probePath: 'models',
    models: [
      { id: 'gpt-4.1', label: 'GPT-4.1', pricing: { inputPerM: 2, outputPerM: 8 } },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', pricing: { inputPerM: 0.4, outputPerM: 1.6 } },
      { id: 'gpt-4o', label: 'GPT-4o', pricing: { inputPerM: 2.5, outputPerM: 10 } },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseURL: 'https://api.anthropic.com/v1/',
    keySecret: `${MODEL_KEY_PREFIX}ANTHROPIC`,
    probePath: 'models',
    models: [
      { id: 'claude-opus-5', label: 'Claude Opus 5', pricing: { inputPerM: 5, outputPerM: 25 } },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', pricing: { inputPerM: 3, outputPerM: 15 } },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', pricing: { inputPerM: 1, outputPerM: 5 } },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1/',
    keySecret: `${MODEL_KEY_PREFIX}OPENROUTER`,
    probePath: 'models',
    // A gateway namespaces its models by vendor, so an id here carries an
    // interior slash (`anthropic/claude-sonnet-5`) — parseModelRef allows that,
    // and the id only ever travels in the request body. Prices move with the
    // upstream vendor and the route taken, so none are pinned: a space that
    // wants its cap to bind declares `pricing:` on the connector note.
    models: [
      { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', pricing: null },
      { id: 'openai/gpt-4.1', label: 'GPT-4.1', pricing: null },
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', pricing: null },
    ],
  },
  {
    id: 'custom',
    label: 'Custom endpoint',
    baseURL: null,
    keySecret: `${MODEL_KEY_PREFIX}CUSTOM`,
    probePath: 'models',
    models: [],
  },
]

function providerById(id: string): ProviderEntry | null {
  return PROVIDERS.find((p) => p.id === id) ?? null
}

export interface ModelRef {
  provider: ProviderEntry
  modelId: string
  pricing: ModelPricing | null
}

/**
 * Parse `provider/modelId`. Pure. Returns an error string for the brief's
 * `invalid` reason instead of throwing, connector-style.
 */
export function parseModelRef(raw: unknown): { ok: true; ref: ModelRef } | { ok: false; error: string } {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: '`model` is required (e.g. gemini/gemma-4-31b-it)' }
  const value = raw.trim()
  const slash = value.indexOf('/')
  if (slash <= 0 || slash === value.length - 1) {
    return { ok: false, error: '`model` must be <provider>/<model-id>, e.g. gemini/gemma-4-31b-it' }
  }
  const providerId = value.slice(0, slash).toLowerCase()
  const modelId = value.slice(slash + 1)
  const provider = providerById(providerId)
  if (!provider) {
    return {
      ok: false,
      error: `unknown model provider "${providerId}" — one of ${PROVIDERS.map((p) => p.id).join(', ')}`,
    }
  }
  // A model id may carry interior slashes, because a gateway namespaces its
  // models by vendor (`custom/z-ai/glm-5.3-flash`). Only the
  // FIRST slash separates provider from model, so the rest belong to the id.
  // The id is sent in the request body and never in a URL path, so a slash here
  // cannot steer a request anywhere — the endpoint is the connector's
  // `base_url:`, pinned and SSRF-checked on save and on every resolve.
  if (!/^[A-Za-z0-9._:-]+(\/[A-Za-z0-9._:-]+)*$/.test(modelId) || modelId.length > 128) {
    return { ok: false, error: 'model id has unexpected characters' }
  }
  const known = provider.models.find((m) => m.id === modelId)
  return { ok: true, ref: { provider, modelId, pricing: known?.pricing ?? null } }
}

