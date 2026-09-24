/**
 * The fetched tier of the pricing chain: pull a public model catalogue into
 * `agent_model_prices` so a brief naming a model nobody hand-priced still
 * meters in dollars. Parsing is lib/agents/shared/prices.ts (pure, tested);
 * this file is the fetch and the writes.
 *
 * Runs from the nightly maintenance sweep (lib/notes/nightly.ts) and by hand
 * via `pnpm db:prices`. The catalogue replaces only its own rows, and only
 * when its fetch parsed — a catalogue being down costs freshness, never the
 * table. The URL is a pinned literal, like every provider base URL.
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import type { ModelPricing } from './registry'
import { mergePriceRows, rowsFromLiteLlm, type ModelPriceRow } from './shared/prices'

const LITELLM_PRICES_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

const FETCH_TIMEOUT_MS = 30_000

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store' })
  if (!res.ok) throw new Error(`${url} answered ${res.status}`)
  return res.json()
}

/** Replace one catalogue's rows. A parse yielding nothing writes nothing. */
async function replaceSource(source: ModelPriceRow['source'], rows: ModelPriceRow[]): Promise<number> {
  if (rows.length === 0) return 0
  await prisma.$transaction([
    prisma.agentModelPrice.deleteMany({ where: { source } }),
    prisma.agentModelPrice.createMany({
      data: rows.map((r) => ({
        provider: r.provider,
        model: r.model,
        inputPerM: r.pricing.inputPerM,
        outputPerM: r.pricing.outputPerM,
        cachedInputPerM: r.pricing.cachedInputPerM ?? null,
        source: r.source,
      })),
      skipDuplicates: true,
    }),
  ])
  return rows.length
}

/**
 * Refresh the catalogue. Never throws: a failure is logged (warn — an upstream
 * catalogue being down is the world working as designed).
 */
export async function syncModelPrices(): Promise<{ litellm: number }> {
  const result = { litellm: 0 }
  try {
    const rows = mergePriceRows(rowsFromLiteLlm(await fetchJson(LITELLM_PRICES_URL)))
    result.litellm = await replaceSource('litellm', rows)
  } catch (err) {
    logger.warn('agents.prices.litellm_failed', { err })
  }
  return result
}

/** The fetched price for one (provider, model), or null when the table has none. */
export async function fetchedPricing(provider: string, model: string): Promise<ModelPricing | null> {
  const row = await prisma.agentModelPrice.findUnique({
    where: { price_identity: { provider, model } },
    select: { inputPerM: true, outputPerM: true, cachedInputPerM: true },
  })
  if (!row) return null
  return {
    inputPerM: row.inputPerM,
    outputPerM: row.outputPerM,
    ...(row.cachedInputPerM !== null ? { cachedInputPerM: row.cachedInputPerM } : {}),
  }
}
