// Which models a space has, and which one an agent that names none runs on
// (lib/agents/spaceModels.ts). Pure over parsed notes, so no database.
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/agents-space-models.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  customEndpointOf,
  declaredPricingFor,
  defaultModelOf,
  noModelReason,
  runnableModels,
  type SpaceModel,
} from '@/lib/agents/spaceModels'
import { PROVIDERS } from '@/lib/agents/registry'
import { parseModel } from '@/lib/models/config'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'

function provider(id: string) {
  const p = PROVIDERS.find((x) => x.id === id)
  assert.ok(p, `no provider ${id}`)
  return p
}

function model(over: Partial<SpaceModel> & { name: string; providerId: string }): SpaceModel {
  const p = provider(over.providerId)
  const modelId = over.modelId !== undefined ? over.modelId : (p.models[0]?.id ?? null)
  return {
    name: over.name,
    path: over.path ?? `models/${over.name}.md`,
    recipe: over.recipe ?? null,
    title: over.title ?? null,
    provider: p,
    modelId,
    ref: modelId ? `${p.id}/${modelId}` : null,
    baseURL: p.baseURL ?? 'https://llm.example.com/v1/',
    keyStored: over.keyStored ?? true,
    enabled: over.enabled ?? true,
    pricing: over.pricing ?? {},
    problem: over.problem ?? null,
  }
}

test('a space with no model says to go and add one', () => {
  assert.equal(defaultModelOf([]), null)
  assert.match(noModelReason([]) ?? '', /no model/i)
  // The message must not name a provider: there is no platform default, and
  // inventing one is what put gemini in briefs nobody could run.
  assert.doesNotMatch(noModelReason([]) ?? '', /gemini|openai|anthropic/i)
})

test('a model that cannot run is not the space’s model, and says why', () => {
  const keyless = model({ name: 'anthropic', providerId: 'anthropic', keyStored: false, problem: 'No key stored — add MODEL_KEY_ANTHROPIC' })
  assert.equal(defaultModelOf([keyless]), null)
  const reason = noModelReason([keyless]) ?? ''
  assert.match(reason, /no model that can run/i)
  // The distinction that matters: this one is a thing to FIX, and it is named.
  assert.match(reason, /anthropic/)
})

test('the first runnable model in note order is the space’s model', () => {
  const a = model({ name: 'anthropic', providerId: 'anthropic' })
  const b = model({ name: 'openai', providerId: 'openai' })
  assert.equal(defaultModelOf([a, b])?.name, 'anthropic')
  // A broken first one is skipped, not fatal.
  const broken = { ...a, problem: 'Turned off' }
  assert.equal(defaultModelOf([broken, b])?.name, 'openai')
  assert.deepEqual(runnableModels([broken, b]).map((m) => m.name), ['openai'])
})

test('one custom endpoint per space, and two is a configuration error', () => {
  const one = model({ name: 'ollama', providerId: 'custom', modelId: 'llama-4' })
  const ok = customEndpointOf([one])
  assert.ok(ok.ok && ok.baseURL === 'https://llm.example.com/v1/')

  const other = { ...model({ name: 'vllm', providerId: 'custom', modelId: 'x' }), baseURL: 'https://other.example.com/v1/' }
  const clash = customEndpointOf([one, other])
  assert.equal(clash.ok, false)
  assert.match(clash.ok ? '' : clash.message, /More than one/)

  assert.equal(customEndpointOf([]).ok, false)
  // A disabled one is not an endpoint, the same way it is not a model.
  assert.equal(customEndpointOf([{ ...one, enabled: false }]).ok, false)
})

test('declared prices come off the notes, first note winning per model id', () => {
  const a = model({ name: 'a', providerId: 'openrouter', modelId: 'x', pricing: { x: { inputPerM: 1, outputPerM: 2 } } })
  const b = model({ name: 'b', providerId: 'openrouter', modelId: 'x', pricing: { x: { inputPerM: 9, outputPerM: 9 }, y: { inputPerM: 3, outputPerM: 4 } } })
  const merged = declaredPricingFor([a, b], 'openrouter')
  assert.deepEqual(merged.x, { inputPerM: 1, outputPerM: 2 })
  assert.deepEqual(merged.y, { inputPerM: 3, outputPerM: 4 })
  // Another provider's notes are not consulted.
  assert.deepEqual(declaredPricingFor([a, b], 'openai'), {})
  // A disabled note prices nothing.
  assert.deepEqual(declaredPricingFor([{ ...a, enabled: false }], 'openrouter'), {})
})

test('a note written before `model:` existed still names a model', () => {
  const note = ['---', 'type: model', 'provider: anthropic', '---', ''].join('\n')
  const parsed = parseModel(parseFrontmatter(note))
  assert.ok(parsed.ok)
  assert.equal(parsed.config.modelId, provider('anthropic').models[0].id)

  // A custom endpoint has nothing to fall back to, and says so rather than
  // failing to parse — an existing note must still load.
  const custom = ['---', 'type: model', 'provider: custom', 'base_url: https://llm.example.com/v1/', '---', ''].join('\n')
  const parsedCustom = parseModel(parseFrontmatter(custom))
  assert.ok(parsedCustom.ok)
  assert.equal(parsedCustom.config.modelId, null)
})

test('a bad model id is refused at parse', () => {
  for (const bad of ['has spaces', 'a'.repeat(129), 'semi;colon']) {
    const note = ['---', 'type: model', 'provider: openai', `model: ${bad}`, '---', ''].join('\n')
    assert.equal(parseModel(parseFrontmatter(note)).ok, false, bad)
  }
  // An id may carry interior slashes: a gateway namespaces by vendor.
  const gateway = ['---', 'type: model', 'provider: openrouter', 'model: anthropic/claude-sonnet-5', '---', ''].join('\n')
  const parsed = parseModel(parseFrontmatter(gateway))
  assert.ok(parsed.ok && parsed.config.modelId === 'anthropic/claude-sonnet-5')
})
