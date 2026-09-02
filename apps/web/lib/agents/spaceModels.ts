/**
 * The models a space has.
 *
 * A model is a CONNECTOR — `connectors/<name>.md` with `kind: model`, naming a
 * provider, the model it runs, and (through the reserved `MODEL_KEY_<PROVIDER>`
 * secret) the key that pays for it. So "which models can we use" has exactly
 * one answer: the ones somebody added under Connectors. There is no platform
 * default, and a space with none has none — an agent built there names no
 * model and says so, rather than pointing at a provider nobody signed up for.
 *
 * This module is the one read of those notes. It used to be three — the custom
 * endpoint, the declared pricing, and the options surface each swept
 * `connectors/` on their own — which is how they came to disagree about what
 * "configured" meant. One read, one verdict, three callers.
 *
 * Read RAW, without a principal, for the same reason the runner does: a run
 * may act for an author who cannot see `connectors/`, and the folder is
 * admin-written anyway. Nothing here returns a key.
 */
import prisma from '@/lib/prisma'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { isConnectorEnabled } from '@/lib/connectors/config'
import { connectorKind, parseModelConnector } from '@/lib/connectors/model'
import type { ModelPricing, ProviderEntry } from './registry'

const SHARED_OWNER_KEY = 'shared'
const CONNECTORS_DIR = 'connectors/'

/** One model connector note, parsed, with whether its key is actually stored. */
export interface SpaceModel {
  /** The note name — `connectors/<name>.md`. */
  connector: string
  provider: ProviderEntry
  /** The model this connector runs; null for a custom endpoint that names none. */
  modelId: string | null
  /** `<provider>/<modelId>` — what a brief's `model:` would say. Null with no id. */
  ref: string | null
  baseURL: string
  /** MODEL_KEY_<PROVIDER> exists for this space. */
  keyStored: boolean
  /** `enabled: false` in the note — configuration held in reserve. */
  enabled: boolean
  /** Prices the note declares, per model id. */
  pricing: Readonly<Record<string, ModelPricing>>
  /** Why this one cannot be run, or null when it can. */
  problem: string | null
}

/**
 * Can this connector actually run something? A note is not a model until it
 * names one and the space holds the key it spends.
 */
function problemWith(m: Omit<SpaceModel, 'problem'>): string | null {
  if (!m.enabled) return 'Turned off'
  if (!m.modelId) return 'Names no model — set `model:` on the note'
  if (!m.keyStored) return `No key stored — add ${m.provider.keySecret} on the connector's page`
  return null
}

/**
 * Every model connector the space has, in note order, whether or not it works.
 * The broken ones are included on purpose: a surface that hides them leaves an
 * admin wondering where the connector they just wrote went.
 */
export async function spaceModels(spaceId: string): Promise<SpaceModel[]> {
  const [rows, secrets] = await Promise.all([
    prisma.contextNote.findMany({
      where: { spaceId, ownerKey: SHARED_OWNER_KEY, deletedAt: null, path: { startsWith: CONNECTORS_DIR, endsWith: '.md' } },
      select: { path: true, content: true },
      orderBy: { path: 'asc' },
    }),
    prisma.connectorSecret.findMany({ where: { spaceId }, select: { name: true } }),
  ])
  const stored = new Set(secrets.map((s) => s.name))

  const out: SpaceModel[] = []
  for (const row of rows) {
    const fm = parseFrontmatter(row.content)
    if (fm.type !== 'connector' || connectorKind(fm) !== 'model') continue
    const parsed = parseModelConnector(fm)
    // An unparseable model connector is a broken note, not a model. It shows
    // up as an invalid connector on its own page, which is where it is fixed.
    if (!parsed.ok) continue
    const base: Omit<SpaceModel, 'problem'> = {
      connector: row.path.slice(CONNECTORS_DIR.length, -'.md'.length),
      provider: parsed.config.provider,
      modelId: parsed.config.modelId,
      ref: parsed.config.modelId ? `${parsed.config.provider.id}/${parsed.config.modelId}` : null,
      baseURL: parsed.config.baseURL,
      keyStored: stored.has(parsed.config.provider.keySecret),
      enabled: isConnectorEnabled(fm),
      pricing: parsed.config.pricing,
    }
    out.push({ ...base, problem: problemWith(base) })
  }
  return out
}

/** The ones that would actually run — in note order, so "the first" is stable. */
export function runnableModels(models: readonly SpaceModel[]): SpaceModel[] {
  return models.filter((m) => m.problem === null)
}

/**
 * The space's model: what an agent that names none runs on.
 *
 * The first runnable model connector in note order. Deterministic and
 * explainable — "the first one under Connectors" is a sentence an admin can
 * act on — and a space wanting a different one renames or disables a note
 * rather than reaching for a setting that exists nowhere else.
 */
export function defaultModelOf(models: readonly SpaceModel[]): SpaceModel | null {
  return runnableModels(models)[0] ?? null
}

/**
 * Why a space has no model to run, phrased for whoever is about to be stopped
 * by it. Null when it has one.
 *
 * The distinction that matters: NO model connector at all is a thing to go and
 * add, and a connector that exists but cannot run is a thing to go and fix.
 * Answering both with "no model key stored for Google Gemini" — a provider the
 * space never chose — is what sent people looking in the wrong place.
 */
export function noModelReason(models: readonly SpaceModel[]): string | null {
  if (defaultModelOf(models)) return null
  if (models.length === 0) {
    return 'This space has no model. Add one under Connectors → Models, and agents can run on it.'
  }
  const listed = models.map((m) => `${m.connector} (${m.problem})`).join('; ')
  return `This space has no model that can run: ${listed}. Fix one under Connectors → Models.`
}

/**
 * The custom endpoint a `custom/<model>` ref resolves against.
 *
 * One per space, like one key per provider: two `provider: custom` connectors
 * with different URLs is a configuration error an admin resolves, not a choice
 * a brief gets to make.
 */
export function customEndpointOf(
  models: readonly SpaceModel[],
): { ok: true; baseURL: string; connector: string; pricing: Readonly<Record<string, ModelPricing>> } | { ok: false; message: string } {
  const custom = models.filter((m) => m.provider.baseURL === null && m.enabled)
  if (custom.length === 0) {
    return { ok: false, message: 'No custom model connector — add one under Connectors → Models with `provider: custom` and its `base_url:`.' }
  }
  const urls = new Set(custom.map((m) => m.baseURL))
  if (urls.size > 1) {
    return {
      ok: false,
      message: `More than one custom model endpoint (${custom.map((m) => m.connector).join(', ')}) — keep one \`provider: custom\` connector, or give them the same base_url.`,
    }
  }
  const [first] = custom
  return { ok: true, baseURL: first.baseURL, connector: first.connector, pricing: first.pricing }
}

/** The prices the space's notes declare for one provider — first note wins per id. */
export function declaredPricingFor(models: readonly SpaceModel[], providerId: string): Record<string, ModelPricing> {
  const out: Record<string, ModelPricing> = {}
  for (const m of models) {
    if (!m.enabled || m.provider.id !== providerId) continue
    for (const [modelId, price] of Object.entries(m.pricing)) {
      if (!(modelId in out)) out[modelId] = price
    }
  }
  return out
}
