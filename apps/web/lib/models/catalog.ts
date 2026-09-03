/**
 * The model catalogue: the providers a space can add a model from, each a
 * recipe — the fields to fill in (the key, the model id, a base URL for a
 * gateway of your own) and the note {@link modelFromCatalog} writes from them.
 *
 * Five rows, not forty: choosing a model is choosing among the providers the
 * registry (lib/agents/registry.ts) knows how to talk to, so the list is the
 * registry's and a new provider is a registry entry first. It is its own
 * catalogue rather than a category of the connector one because a model is not
 * a connector (lib/models/config.ts): nothing here declares hosts, nothing here
 * is runnable, and the key is the provider's reserved `MODEL_KEY_<PROVIDER>`.
 *
 * A provider is ONE row per space. The key is `MODEL_KEY_<PROVIDER>`, one row
 * by construction, and a registry provider's endpoint is pinned in code, so a
 * second note would name the same key and the same URL and differ only in its
 * title; `custom` is the same story from the other end — agents resolve one
 * custom endpoint per space (lib/agents/spaceModels.ts#customEndpointOf).
 * {@link modelCatalogEntryFor} is display-only: a wrong or missing answer
 * costs a logo, never a key or a permission.
 */
import { PROVIDERS } from '@/lib/agents/registry'
import { newModelNote } from './config'

interface ModelCatalogField {
  /** Form key; for a secret field this is also the secret NAME (UPPER_SNAKE). */
  key: string
  label: string
  placeholder?: string
  /** Where to find the value — shown under the input. */
  hint?: string
  /** Stored in the secret store; never written into the note. */
  secret?: boolean
  required?: boolean
  /**
   * A fixed set of values, rendered as a picker. A suggestion, not a gate —
   * the ids the registry ships, with a newer one still typeable, because a
   * provider releases models faster than this file is edited.
   */
  choices?: readonly { value: string; label: string }[]
}

export interface ModelCatalogEntry {
  /** The recipe id — also the note name the first model from it takes. */
  id: string
  name: string
  description: string
  /** Path under /images/connectors — the same logo set connectors draw from. */
  logo: string
  /** The registry provider id. */
  provider: string
  fields: readonly ModelCatalogField[]
}

/** The model ids a registry provider ships, as picker choices. */
function modelChoices(providerId: string): { value: string; label: string }[] {
  const provider = PROVIDERS.find((p) => p.id === providerId)
  return (provider?.models ?? []).map((m) => ({ value: m.id, label: m.label }))
}

const MODEL_FIELD_HINT = 'Which model this runs. Agents use it unless their brief pins another.'

export const MODEL_CATALOG: readonly ModelCatalogEntry[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'Run this space’s agents on OpenAI models',
    logo: 'openai.svg',
    provider: 'openai',
    fields: [
      { key: 'MODEL_KEY_OPENAI', label: 'API key', placeholder: 'sk-…', secret: true, required: true, hint: 'platform.openai.com → API keys.' },
      { key: 'model', label: 'Model', required: true, hint: MODEL_FIELD_HINT, choices: modelChoices('openai'), placeholder: 'model id' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Run this space’s agents on Claude',
    logo: 'anthropic.svg',
    provider: 'anthropic',
    fields: [
      { key: 'MODEL_KEY_ANTHROPIC', label: 'API key', placeholder: 'sk-ant-…', secret: true, required: true, hint: 'console.anthropic.com → API keys.' },
      { key: 'model', label: 'Model', required: true, hint: MODEL_FIELD_HINT, choices: modelChoices('anthropic'), placeholder: 'model id' },
    ],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Run this space’s agents on Gemini',
    logo: 'googlegemini.svg',
    provider: 'gemini',
    fields: [
      { key: 'MODEL_KEY_GEMINI', label: 'API key', placeholder: 'AIza…', secret: true, required: true, hint: 'aistudio.google.com → Get API key.' },
      { key: 'model', label: 'Model', required: true, hint: MODEL_FIELD_HINT, choices: modelChoices('gemini'), placeholder: 'model id' },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'One key, hundreds of models from every vendor',
    logo: 'openrouter.svg',
    provider: 'openrouter',
    fields: [
      { key: 'MODEL_KEY_OPENROUTER', label: 'API key', placeholder: 'sk-or-v1-…', secret: true, required: true, hint: 'openrouter.ai/keys → Create key.' },
      { key: 'model', label: 'Model', required: true, hint: MODEL_FIELD_HINT, choices: modelChoices('openrouter'), placeholder: 'model id' },
    ],
  },
  {
    id: 'custom-model',
    name: 'OpenAI-compatible endpoint',
    description: 'Any provider speaking the OpenAI chat API',
    logo: 'modelcontextprotocol.svg',
    provider: 'custom',
    fields: [
      { key: 'base_url', label: 'Base URL', placeholder: 'https://llm.example.com/v1/', required: true, hint: 'An https endpoint; no query or fragment.' },
      { key: 'MODEL_KEY_CUSTOM', label: 'API key', secret: true, required: true },
      // No choices: nobody but the admin knows what their gateway serves.
      { key: 'model', label: 'Model', required: true, placeholder: 'model id at your endpoint', hint: MODEL_FIELD_HINT },
    ],
  },
]

/**
 * The catalogue row behind a model note: its `recipe:` first, then its
 * provider — a note written before `recipe:` existed, or by hand, still finds
 * its logo. Display only.
 */
export function modelCatalogEntryFor(recipe: string | null | undefined, provider: string | null | undefined): ModelCatalogEntry | null {
  if (recipe) {
    const byRecipe = MODEL_CATALOG.find((e) => e.id === recipe.trim().toLowerCase())
    if (byRecipe) return byRecipe
  }
  if (!provider) return null
  const key = provider.trim().toLowerCase()
  return MODEL_CATALOG.find((e) => e.provider === key) ?? null
}

/**
 * A picked row plus its filled-in form → the note to write and the secret to
 * store. The key never appears in the note; it is the provider's reserved
 * secret and is PUT to the space's secret store beside the note.
 */
export function modelFromCatalog(
  entry: ModelCatalogEntry,
  input: { name: string; title: string; description: string; values: Record<string, string> },
): { content: string; secrets: Array<{ name: string; value: string }> } {
  const v = (key: string) => (input.values[key] ?? '').trim()
  return {
    content: newModelNote({
      name: input.title.trim() || input.name,
      provider: entry.provider,
      baseUrl: v('base_url'),
      model: v('model'),
      description: input.description.trim() || entry.description,
      recipe: entry.id,
    }),
    secrets: entry.fields.filter((f) => f.secret && v(f.key)).map((f) => ({ name: f.key, value: v(f.key) })),
  }
}
