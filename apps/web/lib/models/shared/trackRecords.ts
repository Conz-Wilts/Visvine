/**
 * How often each model finished the jobs it was given — pure.
 *
 * Read from a space's recent runs (lib/models/service.ts#spaceTrackRecords):
 * the model page says it per model, and the agent advice
 * (lib/agents/shared/advice.ts) weighs one model against another by it.
 */

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
