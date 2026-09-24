/**
 * Whether the model an agent runs on can call tools — read from the
 * provider's own public catalogue (shared/capabilities.ts judges it).
 * OpenRouter publishes one; other providers answer null, which means "no
 * objection", never a refusal.
 *
 * The catalogue is public, the same for every tenant, and changes slowly, so
 * one fetch per process an hour is held in memory. A cold instance reads it
 * again; nothing depends on two instances agreeing. Fails open: no catalogue,
 * no problem.
 */
import { logger } from '@/lib/logger'
import { toolsProblemIn, type CatalogModel } from './shared/capabilities'

const OPENROUTER_MODELS = 'https://openrouter.ai/api/v1/models'
const CATALOG_TTL_MS = 60 * 60_000
const FETCH_TIMEOUT_MS = 5_000

let cached: { at: number; models: CatalogModel[] } | null = null

async function openRouterCatalog(): Promise<CatalogModel[] | null> {
  if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached.models
  try {
    const res = await fetch(OPENROUTER_MODELS, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store' })
    if (!res.ok) return cached?.models ?? null
    const data = (await res.json()) as { data?: CatalogModel[] }
    if (!Array.isArray(data.data)) return cached?.models ?? null
    cached = { at: Date.now(), models: data.data.map((m) => ({ id: m.id, supported_parameters: m.supported_parameters })) }
    return cached.models
  } catch (err) {
    logger.warn('models.catalog_unavailable', { err })
    return cached?.models ?? null
  }
}

/** Why `ref` (`<provider>/<model id>`) cannot run an agent, or null. */
export async function modelToolsProblem(ref: string | null): Promise<string | null> {
  if (!ref?.startsWith('openrouter/')) return null
  return toolsProblemIn(await openRouterCatalog(), ref.slice('openrouter/'.length), 'OpenRouter')
}
