// The connector catalog: every entry's recipe must produce a note the real
// parsers accept, with every credential kept out of the note.
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/connector-catalog.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CATALOG_CATEGORIES,
  CONNECTOR_CATALOG,
  catalogEntryFor,
  connectorFromCatalog,
  searchCatalog,
} from '@/lib/connectors/catalog'
import { parseConnectorPerimeter, perimeterSecretRefs } from '@/lib/connectors/config'
import { connectorKind, parseModelConnector } from '@/lib/connectors/model'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { existsSync } from 'node:fs'
import path from 'node:path'

/** A plausible value for every field, so required checks and URL parsing both pass. */
function sampleValues(entry: (typeof CONNECTOR_CATALOG)[number]): Record<string, string> {
  const values: Record<string, string> = {}
  for (const f of entry.fields) {
    values[f.key] =
      f.key === 'url' ? 'https://mcp.example.com/mcp'
      : f.key === 'base_url' ? 'https://llm.example.com/v1/'
      : f.key === 'host' ? 'db.example.com:5432'
      : f.key === 'JIRA_SITE' ? 'acme.atlassian.net'
      : f.key === 'ZENDESK_SUBDOMAIN' ? 'acme'
      : f.secret ? `secret-value-${f.key}`
      : `plain-${f.key}`
  }
  return values
}

test('catalog ids are unique and every category is non-empty', () => {
  const ids = CONNECTOR_CATALOG.map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const c of CATALOG_CATEGORIES) {
    assert.ok(CONNECTOR_CATALOG.some((e) => e.category === c.id), `${c.id} has entries`)
  }
})

test('every logo the catalog names exists under public/images/connectors', () => {
  for (const e of CONNECTOR_CATALOG) {
    assert.ok(existsSync(path.join(process.cwd(), 'public/images/connectors', e.logo)), `${e.id}: ${e.logo}`)
  }
})

test('search matches by name and description, category otherwise', () => {
  assert.deepEqual(searchCatalog('granola').map((e) => e.id), ['granola'])
  assert.ok(searchCatalog('meeting').length >= 2)
  assert.equal(searchCatalog('').length, CONNECTOR_CATALOG.length)
  assert.ok(searchCatalog('LLM keys').every((e) => e.category === 'llm'))
})

for (const entry of CONNECTOR_CATALOG) {
  test(`${entry.id}: the recipe writes a note the parsers accept`, () => {
    const values = sampleValues(entry)
    const { content, secrets } = connectorFromCatalog(entry, {
      name: entry.id,
      title: entry.name,
      description: '',
      values,
    })
    const fm = parseFrontmatter(content)
    assert.equal(fm.type, 'connector')

    // No secret value ever lands in the note; every secret field is stored.
    for (const f of entry.fields.filter((x) => x.secret)) {
      assert.ok(!content.includes(values[f.key]), `${f.key} leaked into ${entry.id}`)
      assert.ok(secrets.some((s) => s.name === f.key && s.value === values[f.key]), `${f.key} stored`)
    }

    if (entry.shape === 'model') {
      assert.equal(connectorKind(fm), 'model')
      const parsed = parseModelConnector(fm)
      assert.ok(parsed.ok, `${entry.id}: ${parsed.ok ? '' : parsed.error}`)
      return
    }

    const parsed = parseConnectorPerimeter(fm)
    assert.ok(parsed.ok, `${entry.id}: ${parsed.ok ? '' : parsed.error}`)
    assert.equal(parsed.legacy, null)
    assert.ok(parsed.perimeter.hosts.length > 0, `${entry.id} reaches something`)
    // Every secret the note references is one the form stored.
    for (const ref of perimeterSecretRefs(parsed.perimeter)) {
      assert.ok(secrets.some((s) => s.name === ref), `${entry.id} references unstored ${ref}`)
    }
    if (entry.shape === 'oauth') assert.ok(parsed.perimeter.auth, `${entry.id} has an auth block`)
  })
}

test('catalogEntryFor finds a note\'s logo by name, then by model provider', () => {
  const first = CONNECTOR_CATALOG[0]
  assert.equal(catalogEntryFor(first.id)?.id, first.id)
  // The name is a slug, so casing and stray space must not lose the mark.
  assert.equal(catalogEntryFor(` ${first.id.toUpperCase()} `)?.id, first.id)

  // A model connector renamed at connect time still keeps its provider's mark.
  const model = CONNECTOR_CATALOG.find((e) => e.shape === 'model' && e.provider)
  if (model) {
    assert.equal(catalogEntryFor('our-house-model', model.provider)?.id, model.id)
  }

  // A connector the space wrote itself matches nothing — the caller draws a plug.
  assert.equal(catalogEntryFor('appdb'), null)
  assert.equal(catalogEntryFor('appdb', null), null)
})
