/**
 * Metering and the two spend ceilings (lib/agents/budget.ts) — pure.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/agents-budget.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { costMicros, formatUsd, MAX_RUN_COST_CENTS, monthBounds, perTurnStop, preRunStop } from '@/lib/agents/budget'
import { capEvents, RUN_EVENTS_BYTES_CAP, type AgentRunEvent } from '@/lib/agents/runs'

const pricing = { inputPerM: 3, outputPerM: 15 } // Sonnet-ish

test('costMicros meters tokens at list price, null without pricing', () => {
  // 1M in + 1M out at $3/$15 = $18 = 18,000,000 micro-dollars
  assert.equal(costMicros({ promptTokens: 1_000_000, completionTokens: 1_000_000 }, pricing), BigInt(18_000_000))
  assert.equal(costMicros({ promptTokens: 1000, completionTokens: 100 }, pricing), BigInt(4_500))
  assert.equal(costMicros({ promptTokens: 1000, completionTokens: 100 }, null), null)
  assert.equal(formatUsd(BigInt(4_500)), '<$0.01')
  assert.equal(formatUsd(BigInt(18_000_000)), '$18.00')
  assert.equal(formatUsd(null), '—')
})

test('preRunStop only when the month is already at the cap', () => {
  assert.equal(preRunStop({ spentThisMonthMicros: BigInt(0), monthlyCapCents: 500, pricing }), null)
  assert.equal(preRunStop({ spentThisMonthMicros: BigInt(5_000_000), monthlyCapCents: 500, pricing }), 'budget')
  assert.equal(preRunStop({ spentThisMonthMicros: BigInt(9_999_999), monthlyCapCents: null, pricing }), null, 'uncapped')
  assert.equal(preRunStop({ spentThisMonthMicros: BigInt(9_999_999), monthlyCapCents: 1, pricing: null }), null, 'no pricing = tokens only')
})

test('perTurnStop: monthly cap counts this run so far; the run cap is a fixed backstop', () => {
  const state = { spentThisMonthMicros: BigInt(4_000_000), monthlyCapCents: 500, pricing }
  assert.equal(perTurnStop(state, { promptTokens: 0, completionTokens: 0 }), null)
  // $1 more in this run reaches the $5 cap.
  assert.equal(perTurnStop(state, { promptTokens: 0, completionTokens: 66_667 }), 'budget')
  // Uncapped, but a runaway run hits the per-run backstop.
  const uncapped = { spentThisMonthMicros: BigInt(0), monthlyCapCents: null, pricing }
  const runawayOut = Math.ceil((MAX_RUN_COST_CENTS / 100 / pricing.outputPerM) * 1_000_000)
  assert.equal(perTurnStop(uncapped, { promptTokens: 0, completionTokens: runawayOut }), 'run_cap')
})

test('monthBounds is the UTC calendar month', () => {
  const { start, end } = monthBounds(new Date('2026-08-17T23:59:59Z'))
  assert.equal(start.toISOString(), '2026-08-01T00:00:00.000Z')
  assert.equal(end.toISOString(), '2026-09-01T00:00:00.000Z')
})

test('capEvents keeps the transcript under the byte cap', () => {
  const events: AgentRunEvent[] = Array.from({ length: 200 }, (_, i) => ({
    at: i,
    type: 'tool_result',
    tool: 'read_context',
    text: 'x'.repeat(5_000),
  }))
  const capped = capEvents(events)
  assert.ok(JSON.stringify(capped).length <= RUN_EVENTS_BYTES_CAP)
  assert.ok(capped.length > 0)
})
