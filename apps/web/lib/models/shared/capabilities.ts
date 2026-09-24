/**
 * Whether a model can do an agent's job at all — pure half.
 *
 * An agent works by calling tools. A model that does not take a `tools`
 * parameter answers every turn in prose, so every run ends having done
 * nothing; a model id the provider does not know fails the first call. Both
 * are knowable before anything runs, from the provider's own catalogue.
 * lib/models/capabilities.ts fetches it; this reads it.
 */

export interface CatalogModel {
  id: string
  supported_parameters?: string[]
}

/** Why `modelId` cannot run an agent, from an OpenRouter-shaped catalogue, or null when it can (or the catalogue says nothing). */
export function toolsProblemIn(catalog: readonly CatalogModel[] | null, modelId: string, providerLabel: string): string | null {
  if (!catalog?.length) return null
  const entry = catalog.find((m) => m.id === modelId)
  if (!entry) return `${providerLabel} has no model called ${modelId}. Check the id on the model's page.`
  if (entry.supported_parameters && !entry.supported_parameters.includes('tools')) {
    return `${modelId} cannot call tools, so an agent on it can read nothing and write nothing. Pick a model that supports tool calling.`
  }
  return null
}

/** Run outcomes that are the MODEL not doing the job — not a budget, a key or a timeout. */
const MODEL_SHORTFALLS = new Set(['incomplete', 'narrated'])

export interface ModelTrackRecord {
  /** `<provider>/<model id>` the runs used. */
  model: string
  finished: number
  /** Runs that ended short: stopped halfway, or described tools instead of calling them. */
  short: number
}

/**
 * How often each model finished the jobs it was given, from its recent runs.
 * Only what the model decides counts: a run stopped by a budget, a rejected
 * key or a provider outage says nothing about whether it could do the job.
 */
export function trackRecords(runs: readonly { model: string; status: string; terminalReason: string | null }[]): ModelTrackRecord[] {
  const by = new Map<string, ModelTrackRecord>()
  for (const r of runs) {
    const done = r.status === 'succeeded'
    const short = r.status === 'failed' && MODEL_SHORTFALLS.has(r.terminalReason ?? '')
    if (!done && !short) continue
    const row = by.get(r.model) ?? { model: r.model, finished: 0, short: 0 }
    if (done) row.finished++
    else row.short++
    by.set(r.model, row)
  }
  return [...by.values()].sort((a, b) => b.finished + b.short - (a.finished + a.short))
}
