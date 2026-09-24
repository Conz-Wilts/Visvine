// Which models a space has, and which one an agent that names none runs on
// (lib/agents/spaceModels.ts). Pure over parsed notes, so no database.
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/agents-space-models.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  customEndpointOf,
  declaredPricingFor,
  defaultModelOf,
  keyBudgetCentsFor,
  modelKeyOwner,
  modelKeysLent,
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
    budgetMonthlyCents: over.budgetMonthlyCents ?? null,
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
  const a = model({ name: 'a', providerId: 'custom', modelId: 'x', pricing: { x: { inputPerM: 1, outputPerM: 2 } } })
  const b = model({ name: 'b', providerId: 'custom', modelId: 'x', pricing: { x: { inputPerM: 9, outputPerM: 9 }, y: { inputPerM: 3, outputPerM: 4 } } })
  const merged = declaredPricingFor([a, b], 'custom')
  assert.deepEqual(merged.x, { inputPerM: 1, outputPerM: 2 })
  assert.deepEqual(merged.y, { inputPerM: 3, outputPerM: 4 })
  // Another provider's notes are not consulted.
  assert.deepEqual(declaredPricingFor([a, b], 'openai'), {})
  // A disabled note prices nothing.
  assert.deepEqual(declaredPricingFor([{ ...a, enabled: false }], 'custom'), {})
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
  const gateway = ['---', 'type: model', 'provider: custom', 'base_url: https://llm.example.com/v1/', 'model: anthropic/claude-sonnet-5', '---', ''].join('\n')
  const parsed = parseModel(parseFrontmatter(gateway))
  assert.ok(parsed.ok && parsed.config.modelId === 'anthropic/claude-sonnet-5')
})

test('a model key is the room\'s own, else the house\'s where the house lends it, else nobody\'s', () => {
  assert.deepEqual(modelKeyOwner({ roomId: 'r', roomHasKey: true, house: null }), { spaceId: 'r', via: 'own' })
  assert.deepEqual(
    modelKeyOwner({ roomId: 'r', roomHasKey: false, house: { id: 'h', modelKeys: 'all', hasKey: true } }),
    { spaceId: 'h', via: 'house' },
  )
  assert.deepEqual(
    modelKeyOwner({ roomId: 'r', roomHasKey: false, house: { id: 'h', modelKeys: ['r', 'x'], hasKey: true } }),
    { spaceId: 'h', via: 'house' },
  )
  // Named rooms only — another room gets nothing.
  assert.equal(modelKeyOwner({ roomId: 'r', roomHasKey: false, house: { id: 'h', modelKeys: ['x'], hasKey: true } }), null)
  // A house that lends but holds no key lends nothing.
  assert.equal(modelKeyOwner({ roomId: 'r', roomHasKey: false, house: { id: 'h', modelKeys: 'all', hasKey: false } }), null)
  // The room's own key wins even when the house would lend.
  assert.deepEqual(
    modelKeyOwner({ roomId: 'r', roomHasKey: true, house: { id: 'h', modelKeys: 'all', hasKey: true } }),
    { spaceId: 'r', via: 'own' },
  )
  assert.equal(modelKeysLent([], 'r'), false)
})

test('keyBudgetCentsFor: the budget on a provider key is the tightest its notes declare', () => {
  const a = model({ name: 'a', providerId: 'custom', modelId: 'x', budgetMonthlyCents: 5000 })
  const b = model({ name: 'b', providerId: 'custom', modelId: 'y', budgetMonthlyCents: 2000, enabled: false })
  const c = model({ name: 'c', providerId: 'anthropic', budgetMonthlyCents: 100 })
  const d = model({ name: 'd', providerId: 'openai' })
  assert.equal(keyBudgetCentsFor([a, b, c, d], 'custom'), 2000, 'the tighter wins, even from a note turned off')
  assert.equal(keyBudgetCentsFor([a, b, c, d], 'anthropic'), 100)
  assert.equal(keyBudgetCentsFor([a, b, c, d], 'openai'), null, 'no budget_monthly: = uncapped')
})

test('budget_monthly: parses as US dollars and refuses anything else', () => {
  const ok = parseModel(parseFrontmatter('---\ntype: model\nprovider: anthropic\nbudget_monthly: 12.5\n---'))
  assert.ok(ok.ok)
  assert.equal(ok.config.budgetMonthlyCents, 1250)
  const none = parseModel({ type: 'model', provider: 'anthropic' })
  assert.ok(none.ok)
  assert.equal(none.config.budgetMonthlyCents, null)
  for (const bad of ['fifty', -1, [50]]) {
    const r = parseModel({ type: 'model', provider: 'anthropic', budget_monthly: bad })
    assert.ok(!r.ok, String(bad))
    assert.match(r.error, /budget_monthly:/)
  }
})
