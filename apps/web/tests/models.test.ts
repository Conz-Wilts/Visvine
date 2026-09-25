// Models: the pure half (lib/models/config.ts) and the catalogue
// (lib/models/catalog.ts). A model is a note at models/<name>.md naming a
// provider and a model id; its key is the provider's reserved secret and
// never a perimeter.
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/models.test.ts
import test from 'node:test'
import { modelNameOfNotePath } from '../lib/notes/shared/configKinds'
import assert from 'node:assert/strict'
import {
  isLegacyModelConnector,
  isModelNote,
  legacyModelNoteToModel,
  modelInfo,
  modelPath,
  newModelNote,
  parseModel,
  parseModelBaseUrl,
} from '@/lib/models/config'
import { MODEL_CATALOG, modelCatalogEntryFor, modelFromCatalog } from '@/lib/models/catalog'
import { PROVIDERS } from '@/lib/agents/registry'
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import { existsSync } from 'node:fs'
import path from 'node:path'

test('a model note parses to its registry provider and never a perimeter', () => {
  const fm = parseFrontmatter(`---
type: model
provider: OpenAI
description: our account
---`)
  assert.ok(isModelNote(fm))
  const parsed = parseModel(fm)
  assert.ok(parsed.ok)
  assert.equal(parsed.config.provider.id, 'openai')
  const info = modelInfo(parsed.config)
  assert.equal(info.keySecret, 'MODEL_KEY_OPENAI')
  assert.equal(info.baseURL, 'https://api.openai.com/v1/')
  assert.equal(info.customEndpoint, false)
  assert.ok(info.models.some((m) => m.id === 'gpt-4.1'))
  assert.equal(isModelNote({ type: 'connector', hosts: [] }), false)
})

test('the paths: models/<name>.md, and the folder index names no model', () => {
  assert.equal(modelPath('anthropic'), 'models/anthropic.md')
  assert.equal(modelNameOfNotePath('models/anthropic.md'), 'anthropic')
  assert.equal(modelNameOfNotePath('models/index.md'), null)
  assert.equal(modelNameOfNotePath('teams/a/b.md'), 'b')
})

test('a model refuses unknown providers and any perimeter field', () => {
  const noProvider = parseModel({ type: 'model' })
  assert.ok(!noProvider.ok)
  assert.match(noProvider.error, /provider:/)

  const unknown = parseModel({ type: 'model', provider: 'mistral' })
  assert.ok(!unknown.ok)
  assert.match(unknown.error, /unknown model provider "mistral"/)

  // A model binding MODEL_KEY_* into an isolate env would let any member with
  // connectors:use read the key — hosts/env/allow are refused.
  for (const key of ['hosts', 'env', 'allow']) {
    const withPerimeter = parseModel({ type: 'model', provider: 'gemini', [key]: [] })
    assert.ok(!withPerimeter.ok, key)
    assert.match(withPerimeter.error, new RegExp(`\`${key}:\``))
  }
  // A pinned provider's endpoint is Visvine's, never the note's.
  const pinned = parseModel({ type: 'model', provider: 'gemini', base_url: 'https://evil.example/' })
  assert.ok(!pinned.ok)
  assert.match(pinned.error, /base_url:/)
})

test('a custom model carries its own base_url, shape-checked like a host', () => {
  const ok = parseModel({ type: 'model', provider: 'custom', base_url: 'https://llm.example.com/v1' })
  assert.ok(ok.ok)
  assert.equal(ok.config.baseURL, 'https://llm.example.com/v1/') // trailing slash normalised
  const info = modelInfo(ok.config)
  assert.equal(info.customEndpoint, true)
  assert.equal(info.keySecret, 'MODEL_KEY_CUSTOM')

  const missing = parseModel({ type: 'model', provider: 'custom' })
  assert.ok(!missing.ok)
  assert.match(missing.error, /base_url:/)
  for (const bad of ['not-a-url', 'http://llm.example.com/v1/', 'https://llm.example.com/v1/?key=1', 'https://{{secret:HOST}}/v1/']) {
    const r = parseModelBaseUrl(bad)
    assert.ok(!r.ok, bad)
  }
})

test('newModelNote round-trips through parseModel', () => {
  const note = newModelNote({ name: 'anthropic', provider: 'anthropic', description: 'Claude, billed to ops' })
  const fm = parseFrontmatter(note)
  assert.equal(fm.type, 'model')
  assert.equal(fm.kind, undefined)
  assert.equal(fm.alias, undefined)
  assert.equal(fm.description, 'Claude, billed to ops')
  const parsed = parseModel(fm)
  assert.ok(parsed.ok)
  assert.equal(parsed.config.provider.id, 'anthropic')
  assert.match(note, /MODEL_KEY_ANTHROPIC/)
  assert.doesNotMatch(note, /hosts:/)

  // A registry provider with no `model:` given falls back to its first.
  assert.equal(parsed.config.modelId, 'claude-opus-5')
  assert.match(note, /^model: claude-opus-5$/m)

  // Named explicitly, it is what the note says and what the model runs.
  const pinned = newModelNote({ name: 'anthropic', provider: 'anthropic', model: 'claude-haiku-4-5' })
  assert.match(pinned, /^model: claude-haiku-4-5$/m)
  const pinnedParsed = parseModel(parseFrontmatter(pinned))
  assert.ok(pinnedParsed.ok && pinnedParsed.config.modelId === 'claude-haiku-4-5')

  const custom = newModelNote({ name: 'ollama', provider: 'custom', baseUrl: 'https://llm.example.com/v1', model: 'llama-4-70b' })
  assert.match(custom, /^base_url: https:\/\/llm\.example\.com\/v1\/$/m)
  assert.match(custom, /^model: llama-4-70b$/m)
  const customParsed = parseModel(parseFrontmatter(custom))
  assert.ok(customParsed.ok && customParsed.config.baseURL === 'https://llm.example.com/v1/')
  assert.throws(() => newModelNote({ name: 'ollama', provider: 'custom', model: 'x' }), /base_url:/)
  // A custom endpoint ships no models, so it has nothing to fall back to.
  assert.throws(
    () => newModelNote({ name: 'ollama', provider: 'custom', baseUrl: 'https://llm.example.com/v1' }),
    /must name one/,
  )
  assert.throws(() => newModelNote({ name: 'x', provider: 'nope' }), /unknown model provider/)
})

test('the legacy shape is recognised, and converts without losing anything', () => {
  const legacy = `---
type: connector
kind: model
title: "Anthropic"
alias: model
provider: anthropic
model: claude-sonnet-5
recipe: anthropic
enabled: false
pricing:
  claude-sonnet-5: { input_per_m: 3, output_per_m: 15 }
---

Body prose.
`
  const fm = parseFrontmatter(legacy)
  assert.ok(isLegacyModelConnector(fm))
  assert.ok(!isModelNote(fm))
  // It still parses as a model — spaceModels reads it until it is moved.
  assert.ok(parseModel(fm).ok)

  const moved = legacyModelNoteToModel(fm, splitFrontmatter(legacy).body)
  const out = joinFrontmatter(moved.fm, moved.body)
  const outFm = parseFrontmatter(out)
  assert.ok(isModelNote(outFm))
  assert.ok(!isLegacyModelConnector(outFm))
  assert.equal(outFm.kind, undefined)
  assert.equal(outFm.alias, undefined)
  assert.equal(outFm.provider, 'anthropic')
  assert.equal(outFm.model, 'claude-sonnet-5')
  assert.equal(outFm.recipe, 'anthropic')
  assert.equal(outFm.enabled, false)
  assert.ok(parseModel(outFm).ok)
  assert.match(out, /Body prose\./)
  // An ordinary connector is not a legacy model.
  assert.ok(!isLegacyModelConnector({ type: 'connector', hosts: ['api.example.com'] }))
})

// ── the catalogue ──

/** A plausible value for every field, so required checks and URL parsing both pass. */
function sampleValues(entry: (typeof MODEL_CATALOG)[number]): Record<string, string> {
  const values: Record<string, string> = {}
  for (const f of entry.fields) {
    values[f.key] = f.key === 'base_url' ? 'https://llm.example.com/v1/' : f.key === 'model' ? 'some-model' : `${f.key}-value`
  }
  return values
}

test('one row per registry provider, each naming its reserved key and shipping a logo', () => {
  assert.deepEqual(
    [...MODEL_CATALOG.map((e) => e.provider)].sort(),
    [...PROVIDERS.map((p) => p.id)].sort(),
  )
  for (const entry of MODEL_CATALOG) {
    const provider = PROVIDERS.find((p) => p.id === entry.provider)!
    assert.ok(entry.fields.some((f) => f.secret && f.key === provider.keySecret), entry.id)
    assert.ok(existsSync(path.join(process.cwd(), 'public/images/connectors', entry.logo)), `${entry.id} logo`)
  }
})

for (const entry of MODEL_CATALOG) {
  test(`${entry.id}: the recipe writes a note the parser accepts, with the key kept out of it`, () => {
    const values = sampleValues(entry)
    const { content, secrets } = modelFromCatalog(entry, { name: entry.id, title: entry.name, description: '', values })
    const fm = parseFrontmatter(content)
    assert.ok(isModelNote(fm))
    assert.equal(fm.recipe, entry.id)
    const parsed = parseModel(fm)
    assert.ok(parsed.ok, `${entry.id}: ${parsed.ok ? '' : parsed.error}`)
    assert.equal(parsed.config.modelId, values.model)
    for (const f of entry.fields.filter((x) => x.secret)) {
      assert.ok(!content.includes(values[f.key]), `${f.key} leaked into ${entry.id}`)
      assert.ok(secrets.some((s) => s.name === f.key && s.value === values[f.key]), `${f.key} stored`)
    }
  })
}

test('modelCatalogEntryFor: recipe first, provider as the fallback, display only', () => {
  assert.equal(modelCatalogEntryFor('anthropic', null)?.id, 'anthropic')
  assert.equal(modelCatalogEntryFor(null, 'anthropic')?.id, 'anthropic')
  assert.equal(modelCatalogEntryFor(null, 'custom')?.id, 'custom-model')
  assert.equal(modelCatalogEntryFor('nope', 'nope'), null)
  assert.equal(modelCatalogEntryFor(null, null), null)
})
