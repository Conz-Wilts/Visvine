/**
 * toolsProblemIn (lib/models/shared/capabilities.ts): a model that cannot call
 * tools, or that the provider does not know, is said before anything runs.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/model-capabilities.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { toolsProblemIn, trackRecords } from '@/lib/models/shared/capabilities'

const CATALOG = [
  { id: 'google/gemini-3.8-flash', supported_parameters: ['tools', 'temperature'] },
  { id: 'some/image-model', supported_parameters: ['temperature'] },
  { id: 'old/model' },
]

test('a model that takes tools passes; one that does not, or is unknown, is named', () => {
  assert.equal(toolsProblemIn(CATALOG, 'google/gemini-3.8-flash', 'OpenRouter'), null)
  assert.match(toolsProblemIn(CATALOG, 'some/image-model', 'OpenRouter') ?? '', /cannot call tools/)
  assert.match(toolsProblemIn(CATALOG, 'google/gemini-9-typo', 'OpenRouter') ?? '', /has no model called/)
  assert.equal(toolsProblemIn(CATALOG, 'old/model', 'OpenRouter'), null, 'a catalogue that says nothing objects to nothing')
  assert.equal(toolsProblemIn(null, 'anything', 'OpenRouter'), null, 'no catalogue, no problem')
})

test('a model track record counts only what the model decides', () => {
  const runs = [
    { model: 'openrouter/a', status: 'succeeded', terminalReason: 'finished' },
    { model: 'openrouter/a', status: 'failed', terminalReason: 'incomplete' },
    { model: 'openrouter/a', status: 'failed', terminalReason: 'budget' },
    { model: 'openrouter/b', status: 'failed', terminalReason: 'narrated' },
    { model: 'openrouter/b', status: 'running', terminalReason: null },
  ]
  assert.deepEqual(trackRecords(runs), [
    { model: 'openrouter/a', finished: 1, short: 1 },
    { model: 'openrouter/b', finished: 0, short: 1 },
  ])
})
