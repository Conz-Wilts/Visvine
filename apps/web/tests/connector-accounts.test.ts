import test from 'node:test'
import assert from 'node:assert/strict'
import { CONNECTOR_CATALOG } from '@/lib/connectors/catalog'
import {
  accountConnectPath,
  accountNoteContent,
  accountOnIn,
  accountRecipes,
  accountStatePath,
  isAccountRecipe,
  nextAccountName,
} from '@/lib/connectors/accountRecipes'
import { parseConnectorPerimeter } from '@/lib/connectors/config'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { agentNeeds, hardNeeds } from '@/lib/agents/shared/needs'

const entry = (id: string) => {
  const found = CONNECTOR_CATALOG.find((e) => e.id === id)
  assert.ok(found, `catalogue has ${id}`)
  return found
}

test('a service is an account only when connecting it asks the space for nothing', () => {
  assert.equal(isAccountRecipe(entry('gmail'), ['google']), true)
  // No platform client on the deployment: the space must bring its own app.
  assert.equal(isAccountRecipe(entry('gmail'), []), false)
  // A vetted MCP server registers its own client.
  assert.equal(isAccountRecipe(entry('notion-mcp'), []), true)
  for (const e of CONNECTOR_CATALOG.filter((c) => c.shape === 'key' || c.login)) {
    assert.equal(isAccountRecipe(e, ['google']), false, `${e.id} holds a space's secret`)
  }
})

test('every account recipe renders a note the perimeter parser accepts, per person, binding no secret', () => {
  for (const e of accountRecipes(['google'])) {
    for (const name of [e.id, `${e.id}-2`]) {
      const content = accountNoteContent(e, name)
      const parsed = parseConnectorPerimeter(parseFrontmatter(content))
      assert.ok(parsed.ok, `${name}: ${parsed.ok ? '' : parsed.error}`)
      assert.equal(parsed.perimeter.auth?.mode, 'user', name)
      assert.equal(parsed.perimeter.auth?.provider, name)
      assert.doesNotMatch(content, /\{\{\s*secret:/, `${name} must not read a space's secrets`)
    }
  }
})

test('a second account takes the next name, and state is keyed per person', () => {
  assert.equal(nextAccountName(entry('gmail'), []), 'gmail')
  assert.equal(nextAccountName(entry('gmail'), ['gmail']), 'gmail-2')
  assert.notEqual(accountStatePath('ana', 'gmail'), accountStatePath('ben', 'gmail'))
  assert.equal(accountOnIn(['a'], 'a'), false)
  assert.equal(accountOnIn(['a'], 'b'), true)
})

test('the sign-in link carries only a safe return path', () => {
  assert.equal(accountConnectPath({ recipe: 'gmail' }), '/api/connectors/oauth/start?account=gmail')
  assert.doesNotMatch(accountConnectPath({ name: 'gmail' }, 'https://elsewhere'), /return=/)
  assert.match(accountConnectPath({ name: 'gmail' }, '/settings?section=accounts'), /account_name=gmail&return=/)
})

test('a missing account service is the runner’s sign-in, never a hard need', () => {
  const needs = agentNeeds({
    declared: [{ connector: 'gmail', status: 'missing' }],
    instructions: '',
    modelProblem: null,
    catalog: [
      { id: 'gmail', name: 'Gmail', connects: 'one-click', perMember: true },
      { id: 'stripe', name: 'Stripe', connects: 'key', perMember: false },
    ],
    spaceConnectors: [],
  })
  assert.equal(needs.needs[0].status, 'needs_connection')
  assert.equal(needs.needs[0].who, 'member')
  assert.equal(needs.needs[0].href, '/settings?section=accounts')
  assert.deepEqual(hardNeeds(needs), [])
})
