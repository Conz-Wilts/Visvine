/**
 * The usage rollup shaper (lib/agents/shared/usage.ts) — pure. Rows from
 * agent_model_usage in, the per-month bill out.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/model-usage.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { rollupUsage, type ModelUsageRow } from '@/lib/agents/shared/usage'

const SEP = new Date('2026-09-01T00:00:00Z')
const AUG = new Date('2026-08-01T00:00:00Z')

function row(over: Partial<ModelUsageRow>): ModelUsageRow {
  return {
    month: SEP,
    name: 'digest',
    model: 'openai/gpt-4o',
    runs: 1,
    promptTokens: BigInt(1000),
    completionTokens: BigInt(100),
    costMicros: BigInt(10_000), // 1 cent
    unpricedRuns: 0,
    ...over,
  }
}

test('months come newest first, each summed from its by-model lines', () => {
  const months = rollupUsage([
    row({}),
    row({ model: 'anthropic/claude-haiku-4-5', name: 'watcher', costMicros: BigInt(30_000) }),
    row({ month: AUG, costMicros: BigInt(50_000) }),
  ])
  assert.equal(months.length, 2)
  assert.equal(months[0].month, SEP.toISOString())
  assert.equal(months[0].costCents, 4)
  assert.equal(months[0].runs, 2)
  assert.equal(months[0].promptTokens, 2000)
  assert.equal(months[1].costCents, 5)
})

test('a month splits by model and by agent independently, costliest first', () => {
  const [month] = rollupUsage([
    row({ name: 'a', model: 'openai/gpt-4o', costMicros: BigInt(10_000) }),
    row({ name: 'b', model: 'openai/gpt-4o', costMicros: BigInt(20_000) }),
    row({ name: 'a', model: 'gemini/gemini-2.5-flash', costMicros: BigInt(40_000) }),
  ])
  assert.deepEqual(month.byModel.map((l) => l.key), ['gemini/gemini-2.5-flash', 'openai/gpt-4o'])
  assert.equal(month.byModel[1].costCents, 3, 'two agents on one model fold into one line')
  assert.deepEqual(month.byAgent.map((l) => l.key), ['a', 'b'])
  assert.equal(month.byAgent[0].costCents, 5)
})

test('unpriced runs are counted, not priced', () => {
  const [month] = rollupUsage([
    row({}),
    row({ model: 'custom/local-llm', costMicros: BigInt(0), unpricedRuns: 1, runs: 1 }),
  ])
  assert.equal(month.unpricedRuns, 1)
  assert.equal(month.costCents, 1, 'the unpriced run adds no dollars')
  const unpricedLine = month.byModel.find((l) => l.key === 'custom/local-llm')
  assert.equal(unpricedLine?.unpricedRuns, 1)
})

test('no rows, no months', () => {
  assert.deepEqual(rollupUsage([]), [])
})
