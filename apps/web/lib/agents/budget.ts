/**
 * Money. Pure helpers for metering a run's cost from token usage and deciding
 * when a run must stop. Costs are USD in MICRO-dollars (integers) so nothing
 * here rounds; the panel converts to cents/dollars at the edge.
 *
 * Three ceilings, all soft-but-close (overshoot bounded by one model turn):
 * - the agent's monthly cap (`AgentState.budgetMonthlyCents`, admin-set,
 *   null = uncapped) — checked before the run and between turns;
 * - the space's monthly cap (`featureConfig.agentBudgetMonthlyCents`, set from
 *   the Usage console section), compared against the whole ledger
 *   (`agent_model_usage`) so every agent and every teaching counts toward it;
 * - a fixed per-run backstop (`MAX_RUN_COST_CENTS`) so a runaway loop on an
 *   uncapped agent cannot spend without bound.
 * With BYO keys the softness is tolerable: it is the Space capping its own
 * spend on its own provider account, and the provider bills the overshoot.
 */
import type { ChatUsage } from '@/lib/notes/ai'
import type { ModelPricing } from './registry'

/** Hard per-run backstop, USD cents. */
export const MAX_RUN_COST_CENTS = 200

/**
 * The backstop that does not need prices: total tokens in one run.
 *
 * Every dollar ceiling above is unenforceable when pricing is unknown, which is
 * the ordinary case for a gateway or a self-hosted endpoint (`provider: custom`
 * with no `pricing:` in its note). Without this, an agent on such a model has
 * no ceiling but `max_turns`, and a loop that grows its context each turn is
 * exactly the runaway the cost cap exists to stop. Tokens are the one unit
 * every provider reports, so the last line of defence is counted in them.
 */
export const MAX_RUN_TOKENS = 2_000_000

const MICROS_PER_CENT = 10_000
const MICROS_PER_DOLLAR = 1_000_000

/**
 * Cost of `usage` at `pricing`, in micro-dollars; null when pricing is unknown.
 * Cache-read tokens (a subset of promptTokens) bill at the discounted rate when
 * the pricing declares one, at the full input rate otherwise.
 */
export function costMicros(usage: ChatUsage, pricing: ModelPricing | null): bigint | null {
  if (!pricing) return null
  const cached = Math.min(usage.cachedTokens ?? 0, usage.promptTokens)
  const input = ((usage.promptTokens - cached) * pricing.inputPerM * MICROS_PER_DOLLAR) / 1_000_000
  const cachedCost = (cached * (pricing.cachedInputPerM ?? pricing.inputPerM) * MICROS_PER_DOLLAR) / 1_000_000
  const output = (usage.completionTokens * pricing.outputPerM * MICROS_PER_DOLLAR) / 1_000_000
  return BigInt(Math.round(input + cachedCost + output))
}

export function microsToCents(micros: bigint | null): number | null {
  return micros === null ? null : Number(micros) / MICROS_PER_CENT
}

export function formatUsd(micros: bigint | null): string {
  if (micros === null) return '—'
  const dollars = Number(micros) / MICROS_PER_DOLLAR
  return dollars < 0.01 && dollars > 0 ? '<$0.01' : `$${dollars.toFixed(2)}`
}

export interface BudgetState {
  /** Spent this month before this run, micro-dollars (null when unknown). */
  spentThisMonthMicros: bigint | null
  /** Admin cap in cents; null = uncapped. */
  monthlyCapCents: number | null
  /** Pricing for the run's model; null = tokens only, no dollar enforcement. */
  pricing: ModelPricing | null
  /** The whole space's ledger spend this month (agent_model_usage — every agent, plus teaching). */
  spaceSpentThisMonthMicros?: bigint | null
  /** The space-wide cap (`featureConfig.agentBudgetMonthlyCents`); null/absent = uncapped. */
  spaceCapCents?: number | null
}

function atCap(spentMicros: bigint | null | undefined, capCents: number | null | undefined, extraMicros = BigInt(0)): boolean {
  if (capCents === null || capCents === undefined || spentMicros === null || spentMicros === undefined) return false
  return spentMicros + extraMicros >= BigInt(capCents) * BigInt(MICROS_PER_CENT)
}

/**
 * Should a run start? Null = go; otherwise which cap said no — the message
 * differs, because raising an agent's cap does nothing when the space's is the
 * one that bound. With unknown pricing there is nothing to compare, so the run
 * goes ahead (the panel says "tokens only").
 */
export function preRunStop(state: BudgetState): { cap: 'agent' | 'space' } | null {
  if (state.pricing === null) return null
  if (atCap(state.spentThisMonthMicros, state.monthlyCapCents)) return { cap: 'agent' }
  if (atCap(state.spaceSpentThisMonthMicros, state.spaceCapCents)) return { cap: 'space' }
  return null
}

/**
 * Should the loop stop before its next model call? Checked between turns with
 * the usage accumulated so far in THIS run.
 */
export function perTurnStop(state: BudgetState, runUsage: ChatUsage): 'budget' | 'run_cap' | null {
  // Checked first and regardless of pricing: this is the ceiling that binds on
  // a model nobody has priced.
  if (runUsage.promptTokens + runUsage.completionTokens >= MAX_RUN_TOKENS) return 'run_cap'

  const runCost = costMicros(runUsage, state.pricing)
  if (runCost === null) return null
  if (runCost >= BigInt(MAX_RUN_COST_CENTS) * BigInt(MICROS_PER_CENT)) return 'run_cap'
  if (atCap(state.spentThisMonthMicros, state.monthlyCapCents, runCost)) return 'budget'
  if (atCap(state.spaceSpentThisMonthMicros, state.spaceCapCents, runCost)) return 'budget'
  return null
}

/** The UTC calendar month `at` falls in — spend is attributed by run start. */
export function monthBounds(at: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1))
  return { start, end }
}
