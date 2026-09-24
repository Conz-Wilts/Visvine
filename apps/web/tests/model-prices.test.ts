/**
 * The public-catalogue price mappers (lib/agents/shared/prices.ts) — pure.
 * Outside data in, price rows out: everything malformed is dropped, never
 * coerced, because a wrong price is a wrong cap.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/model-prices.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mergePriceRows, rowsFromLiteLlm, type ModelPriceRow } from '@/lib/agents/shared/prices'

test('LiteLLM map → direct-provider rows; prefixes stripped, non-chat and unknown providers dropped', () => {
  const rows = rowsFromLiteLlm({
    sample_spec: { input_cost_per_token: 0, output_cost_per_token: 0, litellm_provider: 'openai', mode: 'chat' },
    'gpt-4o': {
      input_cost_per_token: 0.0000025,
      output_cost_per_token: 0.00001,
      cache_read_input_token_cost: 0.00000125,
      litellm_provider: 'openai',
      mode: 'chat',
    },
    'gemini/gemini-2.5-flash': {
      input_cost_per_token: 0.0000003,
      output_cost_per_token: 0.0000025,
      litellm_provider: 'gemini',
      mode: 'chat',
    },
    'text-embedding-3-small': { input_cost_per_token: 0.00000002, litellm_provider: 'openai', mode: 'embedding' },
    'bedrock-thing': { input_cost_per_token: 0.000001, output_cost_per_token: 0.000001, litellm_provider: 'bedrock', mode: 'chat' },
  })
  assert.deepEqual(rows, [
    {
      provider: 'openai',
      model: 'gpt-4o',
      pricing: { inputPerM: 2.5, outputPerM: 10, cachedInputPerM: 1.25 },
      source: 'litellm',
    },
    {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      pricing: { inputPerM: 0.3, outputPerM: 2.5 },
      source: 'litellm',
    },
  ])
})

test('garbage payloads yield nothing', () => {
  for (const junk of [null, undefined, 'html error page', 42, [], { data: 'nope' }]) {
    assert.deepEqual(rowsFromLiteLlm(junk), [])
  }
})

test('mergePriceRows: first occurrence of a (provider, model) key wins', () => {
  const row = (model: string, inputPerM: number): ModelPriceRow => ({ provider: 'openai', model, pricing: { inputPerM, outputPerM: 2 }, source: 'litellm' })
  const merged = mergePriceRows([row('x', 1)], [row('x', 9), row('z', 1)])
  assert.equal(merged.length, 2)
  assert.equal(merged[0].pricing.inputPerM, 1, 'the first list held x')
})
