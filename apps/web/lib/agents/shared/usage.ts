/**
 * Shaping agent_model_usage rows into the bill a person reads — pure, so the
 * grouping (per month, then by model and by agent) is testable without a
 * database. The route (app/api/communities/[spaceId]/usage) fetches rows and
 * serializes what this returns; the Usage console section and the model
 * connector's Spend section both render it.
 *
 * Dollars leave as CENTS (numbers — JSON cannot carry BigInt) and tokens as
 * numbers: a month of tokens fits a double long after it has outgrown an Int4.
 */

export interface ModelUsageRow {
  /** First instant of the UTC month. */
  month: Date
  name: string
  /** The brief's `provider/modelId`. */
  model: string
  runs: number
  promptTokens: bigint
  completionTokens: bigint
  costMicros: bigint
  unpricedRuns: number
}

export interface UsageLine {
  /** by-model lines carry the model id; by-agent lines the agent name. */
  key: string
  runs: number
  promptTokens: number
  completionTokens: number
  costCents: number
  unpricedRuns: number
}

export interface MonthUsage {
  /** ISO date of the month's first instant — the row key everywhere. */
  month: string
  runs: number
  promptTokens: number
  completionTokens: number
  costCents: number
  unpricedRuns: number
  byModel: UsageLine[]
  byAgent: UsageLine[]
}

const MICROS_PER_CENT = 10_000

function centsOf(micros: bigint): number {
  return Number(micros) / MICROS_PER_CENT
}

function addTo(map: Map<string, UsageLine>, key: string, row: ModelUsageRow): void {
  const line = map.get(key) ?? { key, runs: 0, promptTokens: 0, completionTokens: 0, costCents: 0, unpricedRuns: 0 }
  line.runs += row.runs
  line.promptTokens += Number(row.promptTokens)
  line.completionTokens += Number(row.completionTokens)
  line.costCents += centsOf(row.costMicros)
  line.unpricedRuns += row.unpricedRuns
  map.set(key, line)
}

/** Costliest first; ties (two free models) by tokens, then name, so the order is stable. */
function sortLines(lines: UsageLine[]): UsageLine[] {
  return lines.sort(
    (a, b) =>
      b.costCents - a.costCents ||
      b.promptTokens + b.completionTokens - (a.promptTokens + a.completionTokens) ||
      a.key.localeCompare(b.key),
  )
}

/** Rows → months, newest first, each with its by-model and by-agent breakdowns. */
export function rollupUsage(rows: ModelUsageRow[]): MonthUsage[] {
  const months = new Map<string, { byModel: Map<string, UsageLine>; byAgent: Map<string, UsageLine> }>()
  for (const row of rows) {
    const key = row.month.toISOString()
    const bucket = months.get(key) ?? { byModel: new Map(), byAgent: new Map() }
    addTo(bucket.byModel, row.model, row)
    addTo(bucket.byAgent, row.name, row)
    months.set(key, bucket)
  }
  return [...months.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, bucket]) => {
      const byModel = sortLines([...bucket.byModel.values()])
      return {
        month,
        runs: byModel.reduce((n, l) => n + l.runs, 0),
        promptTokens: byModel.reduce((n, l) => n + l.promptTokens, 0),
        completionTokens: byModel.reduce((n, l) => n + l.completionTokens, 0),
        costCents: byModel.reduce((n, l) => n + l.costCents, 0),
        unpricedRuns: byModel.reduce((n, l) => n + l.unpricedRuns, 0),
        byModel,
        byAgent: sortLines([...bucket.byAgent.values()]),
      }
    })
}
