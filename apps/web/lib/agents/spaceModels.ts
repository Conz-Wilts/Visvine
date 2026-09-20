/**
 * The models a space has.
 *
 * A model is a NOTE — `models/<name>.md`, `type: model` (lib/models/config.ts)
 * — naming a provider, the model it runs, and (through the reserved
 * `MODEL_KEY_<PROVIDER>` secret) the key that pays for it. So "which models
 * can we use" has exactly one answer: the ones somebody added under Models.
 * There is no platform default, and a space with none has none — an agent
 * built there names no model and says so, rather than pointing at a provider
 * nobody signed up for.
 *
 * This module is the one read of those notes. It used to be three — the custom
 * endpoint, the declared pricing, and the options surface each swept the
 * folder on their own — which is how they came to disagree about what
 * "configured" meant. One read, one verdict, three callers.
 *
 * The shape before `models/` — `connectors/<name>.md` with `kind: model` — is
 * still read here until `db:models:migrate` has moved it, so a space keeps
 * running across the deploy that made models their own kind. A space's own
 * `models/` note wins its name.
 *
 * Read RAW, without a principal, for the same reason the runner does: a run
 * may act for an author who cannot see `models/`, and the folder is
 * admin-written anyway. Nothing here returns a key.
 */
import prisma from '@/lib/prisma'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { isConnectorEnabled } from '@/lib/connectors/config'
import { isLegacyModelConnector, isModelNote, MODELS_DIR, modelNameOfPath, parseModel } from '@/lib/models/config'
import { reachesRoom, subspaceConfigOf } from '@/lib/spaces/subspaces'
import type { ModelPricing, ProviderEntry } from './registry'

const SHARED_OWNER_KEY = 'shared'
const LEGACY_DIR = 'connectors/'

/** One model note, parsed, with whether its key is actually stored. */
export interface SpaceModel {
  /** The note name — `models/<name>.md`. */
  name: string
  /** Where the note is: `models/<name>.md`, or the legacy `connectors/<name>.md`. */
  path: string
  /** The catalogue row it came from (`recipe:`) — display only. */
  recipe: string | null
  title: string | null
  provider: ProviderEntry
  /** The model this connector runs; null for a custom endpoint that names none. */
  modelId: string | null
  /** `<provider>/<modelId>` — what a brief's `model:` would say. Null with no id. */
  ref: string | null
  baseURL: string
  /** MODEL_KEY_<PROVIDER> exists for this space — or for the house that lends it (`keyFrom`). */
  keyStored: boolean
  /**
   * Set when the key this model spends is the PARENT space's, lent down
   * (docs/sub-spaces.md, `subspaceConfig.modelKeys`). The key never leaves
   * that space's store; the room only learns that it may run on it.
   */
  keyFrom?: { id: string; name: string } | null
  /** Set when the note itself is the parent's — a room with no models of its own runs on the house's. */
  sharedFrom?: { id: string; name: string } | null
  /** `enabled: false` in the note — configuration held in reserve. */
  enabled: boolean
  /** Prices the note declares, per model id. */
  pricing: Readonly<Record<string, ModelPricing>>
  /** `budget_monthly:` in cents — the cap on this provider's key; null = uncapped. */
  budgetMonthlyCents: number | null
  /** Why this one cannot be run, or null when it can. */
  problem: string | null
}

/**
 * Can this note actually run something? A note is not a model until it names
 * one and the space holds the key it spends.
 */
function problemWith(m: Omit<SpaceModel, 'problem'>): string | null {
  if (!m.enabled) return 'Turned off'
  if (!m.modelId) return 'Names no model — set `model:` on the note'
  if (!m.keyStored) return `No key stored — add ${m.provider.keySecret} on the model's page`
  return null
}

/**
 * Every model the space has, in note order, whether or not it works. The
 * broken ones are included on purpose: a surface that hides them leaves an
 * admin wondering where the model they just added went.
 */
export async function spaceModels(spaceId: string): Promise<SpaceModel[]> {
  const [own, house] = await Promise.all([modelsOf(spaceId, null), lendingHouseOf(spaceId)])
  if (!house) return own
  // The house's keys fill the gaps in the room's own models…
  const lent = own.map((m) => (m.keyStored || !house.keys.has(m.provider.keySecret) ? m : withHouseKey(m, house)))
  if (lent.length > 0) return lent
  // …and a room with no models at all runs on the house's, key and note both.
  const theirs = await modelsOf(house.id, house.name)
  return theirs.map((m) => ({ ...m, sharedFrom: { id: house.id, name: house.name }, keyFrom: m.keyStored ? { id: house.id, name: house.name } : null }))
}

function withHouseKey(m: SpaceModel, house: { id: string; name: string }): SpaceModel {
  const base = { ...m, keyStored: true, keyFrom: { id: house.id, name: house.name } }
  return { ...base, problem: problemWith(base) }
}

/**
 * The parent space that lends this one its model keys, with the key names it
 * holds — or null when there is no parent, or the parent's `subspaceConfig`
 * does not reach this room (lib/spaces/subspaces.ts#subspaceConfigOf).
 */
async function lendingHouseOf(spaceId: string): Promise<{ id: string; name: string; keys: Set<string> } | null> {
  const row = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { parent: { select: { id: true, name: true, subspaceConfig: true } } },
  })
  const parent = row?.parent
  if (!parent) return null
  if (!modelKeysLent(subspaceConfigOf(parent.subspaceConfig).modelKeys, spaceId)) return null
  const secrets = await prisma.connectorSecret.findMany({ where: { spaceId: parent.id }, select: { name: true } })
  return { id: parent.id, name: parent.name, keys: new Set(secrets.map((s) => s.name)) }
}

/** Pure: whether a house's `modelKeys` setting reaches `roomId`. */
export function modelKeysLent(modelKeys: 'all' | string[], roomId: string): boolean {
  return reachesRoom(modelKeys, roomId)
}

/**
 * Which space's store holds the key a room's model spends: the room's own
 * when it has one, the house's when the house lends it and has it, else
 * nobody's. Pure — the decision the resolver and the readiness surfaces share.
 */
export function modelKeyOwner(input: {
  roomId: string
  roomHasKey: boolean
  house: { id: string; modelKeys: 'all' | string[]; hasKey: boolean } | null
}): { spaceId: string; via: 'own' } | { spaceId: string; via: 'house' } | null {
  if (input.roomHasKey) return { spaceId: input.roomId, via: 'own' }
  if (input.house && input.house.hasKey && modelKeysLent(input.house.modelKeys, input.roomId)) {
    return { spaceId: input.house.id, via: 'house' }
  }
  return null
}

/** One space's own model notes, with whether each key is in ITS store. */
async function modelsOf(spaceId: string, houseName: string | null): Promise<SpaceModel[]> {
  void houseName
  const [rows, secrets] = await Promise.all([
    prisma.contextNote.findMany({
      where: {
        spaceId,
        ownerKey: SHARED_OWNER_KEY,
        deletedAt: null,
        OR: [
          { path: { startsWith: MODELS_DIR, endsWith: '.md' } },
          { path: { startsWith: LEGACY_DIR, endsWith: '.md' } },
        ],
      },
      select: { path: true, content: true },
      orderBy: { path: 'asc' },
    }),
    prisma.connectorSecret.findMany({ where: { spaceId }, select: { name: true } }),
  ])
  const stored = new Set(secrets.map((s) => s.name))

  const out: SpaceModel[] = []
  const seen = new Set<string>()
  // models/ sorts after connectors/, so the legacy shape is met first; a
  // models/ note of the same name replaces it rather than sitting beside it.
  const parsedRows = rows.map((row) => ({ row, fm: parseFrontmatter(row.content) }))
  const ordered = [
    ...parsedRows.filter(({ row }) => row.path.startsWith(MODELS_DIR)),
    ...parsedRows.filter(({ row }) => row.path.startsWith(LEGACY_DIR)),
  ]
  for (const { row, fm } of ordered) {
    const legacy = row.path.startsWith(LEGACY_DIR)
    if (legacy ? !isLegacyModelConnector(fm) : !isModelNote(fm)) continue
    const name = legacy ? row.path.slice(LEGACY_DIR.length, -'.md'.length) : modelNameOfPath(row.path)
    if (!name || seen.has(name)) continue
    const parsed = parseModel(fm)
    // An unparseable model is a broken note, not a model. It shows up as
    // invalid on its own page, which is where it is fixed.
    if (!parsed.ok) continue
    seen.add(name)
    const base: Omit<SpaceModel, 'problem'> = {
      name,
      path: row.path,
      recipe: typeof fm.recipe === 'string' ? fm.recipe.trim().toLowerCase() : null,
      title: typeof fm.title === 'string' ? fm.title : null,
      provider: parsed.config.provider,
      modelId: parsed.config.modelId,
      ref: parsed.config.modelId ? `${parsed.config.provider.id}/${parsed.config.modelId}` : null,
      baseURL: parsed.config.baseURL,
      keyStored: stored.has(parsed.config.provider.keySecret),
      enabled: isConnectorEnabled(fm),
      pricing: parsed.config.pricing,
      budgetMonthlyCents: parsed.config.budgetMonthlyCents,
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
 * The first runnable model in note order. Deterministic and explainable —
 * "the first one under Models" is a sentence an admin can
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
 * The distinction that matters: NO model at all is a thing to go and add, and
 * a model that exists but cannot run is a thing to go and fix.
 * Answering both with "no model key stored for Google Gemini" — a provider the
 * space never chose — is what sent people looking in the wrong place.
 */
export function noModelReason(models: readonly SpaceModel[]): string | null {
  if (defaultModelOf(models)) return null
  if (models.length === 0) {
    return 'This space has no model. Add one in the Space Console under Models, and agents can run on it.'
  }
  const listed = models.map((m) => `${m.name} (${m.problem})`).join('; ')
  return `This space has no model that can run: ${listed}. Fix one in the Space Console under Models.`
}

/**
 * The custom endpoint a `custom/<model>` ref resolves against.
 *
 * One per space, like one key per provider: two `provider: custom` models
 * with different URLs is a configuration error an admin resolves, not a choice
 * a brief gets to make.
 */
export function customEndpointOf(
  models: readonly SpaceModel[],
): { ok: true; baseURL: string; name: string; pricing: Readonly<Record<string, ModelPricing>> } | { ok: false; message: string } {
  const custom = models.filter((m) => m.provider.baseURL === null && m.enabled)
  if (custom.length === 0) {
    return { ok: false, message: 'No custom model — add one under Models with `provider: custom` and its `base_url:`.' }
  }
  const urls = new Set(custom.map((m) => m.baseURL))
  if (urls.size > 1) {
    return {
      ok: false,
      message: `More than one custom model endpoint (${custom.map((m) => m.name).join(', ')}) — keep one \`provider: custom\` model, or give them the same base_url.`,
    }
  }
  const [first] = custom
  return { ok: true, baseURL: first.baseURL, name: first.name, pricing: first.pricing }
}

/**
 * The monthly cap on a provider's key: the `budget_monthly:` its model notes
 * declare. A note stands for its provider's key, so every note on that
 * provider speaks for the same money — two that disagree resolve to the
 * tighter, the one an admin would be surprised to see exceeded. A note that is
 * turned off still caps: its budget is about the key, not about running.
 */
export function keyBudgetCentsFor(models: readonly SpaceModel[], providerId: string): number | null {
  let cap: number | null = null
  for (const m of models) {
    if (m.provider.id !== providerId || m.budgetMonthlyCents === null) continue
    cap = cap === null ? m.budgetMonthlyCents : Math.min(cap, m.budgetMonthlyCents)
  }
  return cap
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
