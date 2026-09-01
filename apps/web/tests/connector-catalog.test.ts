// The connector catalog: every entry's recipe must produce a note the real
// parsers accept, with every credential kept out of the note.
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/connector-catalog.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CATALOG_CATEGORIES,
  CONNECTOR_CATALOG,
  allowsManyConnectors,
  catalogConnectStyle,
  catalogEntryFor,
  catalogRowLabel,
  connectorFromCatalog,
  connectsInOneClick,
  plainFields,
  searchCatalog,
  suggestConnector,
} from '@/lib/connectors/catalog'
import { connectorConnectUrl, safeReturnTo } from '@/lib/connectors/connectUrl'
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

test('a second connector to one service keeps the service, under its own name', () => {
  const drive = CONNECTOR_CATALOG.find((e) => e.id === 'google-drive')
  assert.ok(drive)

  // The name is free the first time and suffixed after that; the title follows.
  assert.deepEqual(suggestConnector(drive, []), { name: 'google-drive', title: 'Google Drive' })
  assert.deepEqual(suggestConnector(drive, ['google-drive']), { name: 'google-drive-2', title: 'Google Drive 2' })
  assert.deepEqual(suggestConnector(drive, ['GOOGLE-DRIVE', 'google-drive-2']), {
    name: 'google-drive-3',
    title: 'Google Drive 3',
  })

  // The note says which service it is to, so the second one is still a Drive
  // even though nothing about its name says so.
  const { content } = connectorFromCatalog(drive, {
    name: 'google-drive-2',
    title: 'Google Drive 2',
    description: '',
    values: sampleValues(drive),
  })
  const fm = parseFrontmatter(content)
  assert.equal(fm.recipe, 'google-drive')
  assert.equal(catalogEntryFor('google-drive-2', null, 'google-drive')?.id, 'google-drive')
  // …and a note that never carried `recipe:` still resolves by name.
  assert.equal(catalogEntryFor('google-drive')?.id, 'google-drive')
})

test('a second connector gets its own secrets and its own linked accounts', () => {
  const slack = CONNECTOR_CATALOG.find((e) => e.id === 'slack')
  const drive = CONNECTOR_CATALOG.find((e) => e.id === 'google-drive')
  assert.ok(slack && drive)

  const first = connectorFromCatalog(slack, { name: 'slack', title: 'Slack', description: '', values: sampleValues(slack) })
  const second = connectorFromCatalog(slack, { name: 'slack-2', title: 'Slack 2', description: '', values: sampleValues(slack) })

  // Secret names are the SPACE's namespace: sharing them would leave the first
  // workspace running on the second's token.
  assert.deepEqual(first.secrets.map((s) => s.name), ['SLACK_BOT_TOKEN'])
  assert.deepEqual(second.secrets.map((s) => s.name), ['SLACK_BOT_TOKEN__SLACK_2'])
  for (const { content, secrets } of [first, second]) {
    const parsed = parseConnectorPerimeter(parseFrontmatter(content))
    assert.ok(parsed.ok)
    for (const ref of perimeterSecretRefs(parsed.perimeter)) {
      assert.ok(secrets.some((s) => s.name === ref), `references unstored ${ref}`)
    }
  }

  // Linked accounts key on the auth provider, so it follows the connector too.
  const driveOne = parseConnectorPerimeter(parseFrontmatter(
    connectorFromCatalog(drive, { name: 'google-drive', title: 'Google Drive', description: '', values: sampleValues(drive) }).content,
  ))
  const driveTwo = parseConnectorPerimeter(parseFrontmatter(
    connectorFromCatalog(drive, { name: 'google-drive-2', title: 'Google Drive 2', description: '', values: sampleValues(drive) }).content,
  ))
  assert.ok(driveOne.ok && driveTwo.ok)
  assert.equal(driveOne.perimeter.auth?.provider, 'google-drive')
  assert.equal(driveTwo.perimeter.auth?.provider, 'google-drive-2')
})

test('a model provider is one connector per space; everything else is many', () => {
  for (const entry of CONNECTOR_CATALOG) {
    assert.equal(allowsManyConnectors(entry), entry.shape !== 'model', entry.id)
  }
  // The reason, asserted where it lives: every model recipe names the one
  // reserved key its provider reads (lib/agents/registry.ts).
  for (const entry of CONNECTOR_CATALOG.filter((e) => e.shape === 'model')) {
    assert.ok(entry.fields.some((f) => f.secret && f.key.startsWith('MODEL_KEY_')), entry.id)
  }
})

test('a model recipe stamps its service too', () => {
  const openrouter = CONNECTOR_CATALOG.find((e) => e.id === 'openrouter')
  assert.ok(openrouter)
  const { content } = connectorFromCatalog(openrouter, {
    name: 'openrouter',
    title: 'OpenRouter',
    description: '',
    values: sampleValues(openrouter),
  })
  const fm = parseFrontmatter(content)
  assert.equal(fm.recipe, 'openrouter')
  assert.ok(parseModelConnector(fm).ok)
})

test('google recipes: blank credential fields fall back to the platform client', () => {
  for (const id of ['google', 'google-drive']) {
    const entry = CONNECTOR_CATALOG.find((e) => e.id === id)
    assert.ok(entry)
    const { content, secrets } = connectorFromCatalog(entry, {
      name: entry.id,
      title: entry.name,
      description: '',
      values: {},
    })
    const parsed = parseConnectorPerimeter(parseFrontmatter(content))
    assert.ok(parsed.ok, `${id}: ${parsed.ok ? '' : parsed.error}`)
    const auth = parsed.perimeter.auth
    assert.ok(auth, `${id} keeps its auth block`)
    // The deployment's own client: nothing to paste, nothing stored, and no
    // dangling {{secret:…}} the space never filled in.
    assert.equal(auth.clientId, 'platform:google')
    assert.equal(auth.clientSecret, null)
    assert.deepEqual(secrets, [])
    assert.ok(!content.includes('{{secret:'), `${id} references no secrets`)
    // Offline access is what keeps an agent's run alive past the first hour.
    assert.equal(auth.params.access_type, 'offline')
    assert.equal(auth.params.prompt, 'consent')
  }
})

test('google recipes: filled credential fields still produce an own-app note', () => {
  const entry = CONNECTOR_CATALOG.find((e) => e.id === 'google-drive')
  assert.ok(entry)
  const values = sampleValues(entry)
  const { content, secrets } = connectorFromCatalog(entry, {
    name: entry.id,
    title: entry.name,
    description: '',
    values,
  })
  const parsed = parseConnectorPerimeter(parseFrontmatter(content))
  assert.ok(parsed.ok)
  assert.equal(parsed.perimeter.auth?.clientId, values.GOOGLE_DRIVE_CLIENT_ID)
  assert.equal(parsed.perimeter.auth?.clientSecret, '{{secret:GOOGLE_DRIVE_CLIENT_SECRET}}')
  assert.ok(secrets.some((s) => s.name === 'GOOGLE_DRIVE_CLIENT_SECRET'))
})

test('google: extra scopes append to the defaults and never reach env', () => {
  const entry = CONNECTOR_CATALOG.find((e) => e.id === 'google')
  assert.ok(entry)
  const { content } = connectorFromCatalog(entry, {
    name: 'google',
    title: 'Google',
    description: '',
    values: { extra_scopes: 'https://www.googleapis.com/auth/gmail.send' },
  })
  const parsed = parseConnectorPerimeter(parseFrontmatter(content))
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  const scopes = parsed.perimeter.auth?.scopes ?? []
  assert.ok(scopes.includes('https://www.googleapis.com/auth/gmail.readonly'))
  assert.ok(scopes.includes('https://www.googleapis.com/auth/gmail.send'))
  // A scope list is authorization config, not something an agent reads at run time.
  assert.equal(parsed.perimeter.env.extra_scopes, undefined)
  assert.ok(!JSON.stringify(parsed.perimeter.env).includes('gmail.send'))
})

test('one-click Connect is offered only where there is nothing to ask', () => {
  const google = CONNECTOR_CATALOG.find((e) => e.id === 'google')
  const drive = CONNECTOR_CATALOG.find((e) => e.id === 'google-drive')
  const microsoft = CONNECTOR_CATALOG.find((e) => e.id === 'microsoft')
  const slack = CONNECTOR_CATALOG.find((e) => e.id === 'slack')
  assert.ok(google && drive && microsoft && slack)

  // Google rides the deployment's own OAuth app and every field it offers is
  // advanced, so pressing Connect is the whole interaction.
  assert.equal(connectsInOneClick(google, ['google']), true)
  assert.equal(connectsInOneClick(drive, ['google']), true)
  assert.deepEqual(plainFields(google), [])

  // …but only on a deployment that HOLDS that client. With none configured the
  // one-click path would send someone to a provider that refuses them.
  assert.equal(connectsInOneClick(google, []), false)
  assert.equal(connectsInOneClick(drive, ['microsoft']), false)

  // Microsoft needs an app registration of the space's own, and Slack is not
  // OAuth at all — both keep the form.
  assert.equal(connectsInOneClick(microsoft, ['google', 'microsoft']), false)
  assert.equal(connectsInOneClick(slack, ['google']), false)
  assert.ok(plainFields(microsoft).length > 0)
})

test('every advanced field is optional, so hiding one can never block a connect', () => {
  for (const entry of CONNECTOR_CATALOG) {
    for (const f of entry.fields.filter((x) => x.advanced)) {
      assert.ok(!f.required, `${entry.id}.${f.key} is advanced but required`)
    }
  }
})

test('a one-click recipe writes a complete note from no input at all', () => {
  for (const entry of CONNECTOR_CATALOG.filter((e) => connectsInOneClick(e, ['google']))) {
    const { name, title } = suggestConnector(entry, [])
    const { content, secrets } = connectorFromCatalog(entry, { name, title, description: '', values: {} })
    const parsed = parseConnectorPerimeter(parseFrontmatter(content))
    assert.ok(parsed.ok, `${entry.id}: ${parsed.ok ? '' : parsed.error}`)
    assert.ok(parsed.perimeter.auth, `${entry.id} has an auth block`)
    assert.deepEqual(secrets, [], `${entry.id} needs no secret stored`)
    assert.ok(parsed.perimeter.hosts.length > 0, `${entry.id} reaches something`)
  }
})

test('a return path is a relative path on this app or nothing', () => {
  assert.equal(safeReturnTo('/settings?section=connectors'), '/settings?section=connectors')
  assert.equal(safeReturnTo('/admin?section=connectors&tab=mine'), '/admin?section=connectors&tab=mine')
  assert.equal(safeReturnTo(null), null)
  assert.equal(safeReturnTo(''), null)
  // An open redirect off the back of an authenticated flow is the whole risk.
  assert.equal(safeReturnTo('https://evil.example/steal'), null)
  assert.equal(safeReturnTo('//evil.example/steal'), null)
  assert.equal(safeReturnTo('/\\evil.example'), null)
  assert.equal(safeReturnTo('javascript:alert(1)'), null)
  // A Location header takes what it is given, so control characters never pass.
  assert.equal(safeReturnTo('/settings\r\nSet-Cookie: a=b'), null)
  assert.equal(safeReturnTo('/set tings'), null)

  // The link the console builds carries it; the link without one does not.
  const url = new URL(connectorConnectUrl('me:u1', 'google-drive', '/settings?section=connectors'))
  assert.equal(url.pathname, '/api/connectors/oauth/start')
  assert.equal(url.searchParams.get('space'), 'me:u1')
  assert.equal(url.searchParams.get('connector'), 'google-drive')
  assert.equal(url.searchParams.get('return'), '/settings?section=connectors')
  assert.equal(new URL(connectorConnectUrl('s1', 'google')).searchParams.get('return'), null)
  assert.equal(
    new URL(connectorConnectUrl('s1', 'google', 'https://evil.example')).searchParams.get('return'),
    null,
  )
})

test('a service you paste a credential into is named for what it is', () => {
  const label = (id: string) => {
    const e = CONNECTOR_CATALOG.find((x) => x.id === id)
    assert.ok(e, id)
    return catalogRowLabel(e)
  }
  // One press or a sign-in: the plain name.
  assert.equal(label('google-drive'), 'Google Drive')
  assert.equal(label('microsoft'), 'Microsoft')
  // A credential you go and fetch is a different kind of thing, and the list
  // says so before anyone clicks.
  assert.equal(label('slack'), 'Slack API')
  assert.equal(label('granola'), 'Granola API')
  // …except where the suffix would read as a lie: a database is not an API,
  // and a model provider and the catch-alls already say what they are.
  assert.equal(label('postgres'), CONNECTOR_CATALOG.find((e) => e.id === 'postgres')!.name)
  assert.equal(label('mcp'), CONNECTOR_CATALOG.find((e) => e.id === 'mcp')!.name)
  for (const e of CONNECTOR_CATALOG.filter((x) => x.shape === 'model')) {
    assert.equal(catalogRowLabel(e), e.name)
  }
})

test('how a service connects is one of three answers', () => {
  const style = (id: string, platform: string[] = ['google']) => {
    const e = CONNECTOR_CATALOG.find((x) => x.id === id)
    assert.ok(e, id)
    return catalogConnectStyle(e, platform)
  }
  assert.equal(style('google-drive'), 'one-click')
  // No platform client for it: the same row is a sign-in you must configure.
  assert.equal(style('google-drive', []), 'sign-in')
  assert.equal(style('microsoft'), 'sign-in')
  assert.equal(style('slack'), 'key')
})
