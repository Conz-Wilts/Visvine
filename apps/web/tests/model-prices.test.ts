/**
 * The public-catalogue price mappers (lib/agents/shared/prices.ts) — pure.
 * Outside data in, price rows out: everything malformed is dropped, never
 * coerced, because a wrong price is a wrong cap.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/model-prices.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mergePriceRows, rowsFromLiteLlm, rowsFromOpenRouter } from '@/lib/agents/shared/prices'

test('OpenRouter payload → openrouter rows, per-token strings scaled to per-million', () => {
  const rows = rowsFromOpenRouter({
    data: [
      {
        id: 'anthropic/claude-sonnet-5',
        pricing: { prompt: '0.000003', completion: '0.000015', input_cache_read: '0.0000003' },
      },
      { id: 'free/model', pricing: { prompt: '0', completion: '0' } },
      // Dropped, each for its own reason:
      { id: 'no-pricing/model' },
      { id: 'bad price/model', pricing: { prompt: 'lots', completion: '0.1' } },
      { id: 'has spaces in id', pricing: { prompt: '0.000001', completion: '0.000001' } },
      { id: 'absurd/model', pricing: { prompt: '1', completion: '1' } }, // $1M per M tokens
    ],
  })
  assert.deepEqual(rows, [
    {
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-5',
      pricing: { inputPerM: 3, outputPerM: 15, cachedInputPerM: 0.3 },
      source: 'openrouter',
    },
    { provider: 'openrouter', model: 'free/model', pricing: { inputPerM: 0, outputPerM: 0 }, source: 'openrouter' },
  ])
})

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
    assert.deepEqual(rowsFromOpenRouter(junk), [])
    assert.deepEqual(rowsFromLiteLlm(junk), [])
  }
})

test('mergePriceRows: first occurrence of a (provider, model) key wins', () => {
  const a = rowsFromOpenRouter({
    data: [{ id: 'x/y', pricing: { prompt: '0.000001', completion: '0.000002' } }],
  })
  const b = rowsFromOpenRouter({
    data: [
      { id: 'x/y', pricing: { prompt: '0.000009', completion: '0.000009' } },
      { id: 'x/z', pricing: { prompt: '0.000001', completion: '0.000001' } },
    ],
  })
  const merged = mergePriceRows(a, b)
  assert.equal(merged.length, 2)
  assert.equal(merged[0].pricing.inputPerM, 1, 'the first list held x/y')
})
