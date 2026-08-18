// Unit tests for the MCP server's pure layers: the scope catalogue, access-token
// mint/verify (including the guard that stops a web session JWT being replayed
// as an MCP token), PKCE verification, and the creatable-type rule that decides
// what the context layer can make.
//
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/mcp.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { SignJWT } from 'jose'
import {
  MCP_SCOPES,
  DEFAULT_SCOPES,
  TOOL_SCOPES,
  scopeForTool,
  parseScopes,
  negotiateScopes,
  serializeScopes,
} from '@/lib/mcp/scopes'
import { mintAccessToken, verifyAccessToken } from '@/lib/mcp/tokens'
import {
  mcpResourceUrl,
  mcpServerInfo,
  canonicalizeResource,
  isCanonicalResource,
} from '@/lib/mcp/config'
import {
  isClientIdUrl,
  validateRedirectUri,
  inferApplicationType,
  parseClientIdDocument,
  ClientResolutionError,
} from '@/lib/mcp/clients'
import { missingScopesForBody } from '@/lib/mcp/challenge'
import { authorizationServerMetadata, protectedResourceMetadata } from '@/lib/mcp/metadata'
import { verifyPkceS256 } from '@/lib/mcp/oauth'
import { CREATABLE_TYPES, isCreatableType } from '@/lib/directory/createEntity'
import { mentionFor } from '@/lib/mcp/tools'
import { canonicalNodeType, nodeTypeSpellings } from '@/lib/types/context'
import { entityMentionPaths } from '@/lib/notes/entities'
import { buildTypeCatalog } from '@/lib/mcp/typeCatalog'

// Both the signing secret and the token audience are read lazily, inside the
// functions under test, so setting them after the imports is enough.
process.env.AUTH_SECRET ??= 'test-secret-for-mcp-tests'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const IDENTITY = { userId: 'user_1', name: 'Test User', email: 'test@local.dev', personId: null }

test('the catalogue is the two context scopes plus the four capability scopes', () => {
  assert.deepEqual(
    [...MCP_SCOPES],
    [
      'context:read',
      'context:write',
      'connectors:use',
      'agents:run',
      'tools:author',
      'tools:install',
    ],
  )
  assert.deepEqual(DEFAULT_SCOPES, ['context:read'])
})

test('parseScopes keeps valid scopes and drops retired ones', () => {
  // The old catalogue's names must not survive a refresh of an existing grant.
  assert.deepEqual(parseScopes('context:read crm:write directory:read'), ['context:read'])
  assert.deepEqual(parseScopes(''), [])
  assert.deepEqual(parseScopes(null), [])
})

test('negotiateScopes falls back to read-only and honours the client allowlist', () => {
  assert.deepEqual(negotiateScopes(null, null), ['context:read'])
  assert.deepEqual(negotiateScopes('context:read context:write', null), [
    'context:read',
    'context:write',
  ])
  // A client that only registered for reads cannot request writes.
  assert.deepEqual(negotiateScopes('context:read context:write', 'context:read'), ['context:read'])
})

// ── MCP 2026-07-28: resource indicators (RFC 8707) ──

test('canonicalizeResource normalises exactly what the spec says is insignificant', () => {
  // Uppercase scheme/host must be accepted; a trailing slash is not significant.
  assert.equal(canonicalizeResource('HTTPS://MCP.Example.com/mcp'), 'https://mcp.example.com/mcp')
  assert.equal(canonicalizeResource('https://mcp.example.com/mcp/'), 'https://mcp.example.com/mcp')
  assert.equal(canonicalizeResource('https://mcp.example.com/'), 'https://mcp.example.com')
  assert.equal(canonicalizeResource('https://mcp.example.com:8443'), 'https://mcp.example.com:8443')
  // A fragment is forbidden outright, and a bare host has no scheme to speak of.
  assert.equal(canonicalizeResource('https://mcp.example.com#frag'), null)
  assert.equal(canonicalizeResource('mcp.example.com'), null)
  assert.equal(canonicalizeResource(null), null)
})

test('only our own resource identifier is an acceptable audience', () => {
  assert.equal(isCanonicalResource(mcpResourceUrl()), true)
  assert.equal(isCanonicalResource(`${mcpResourceUrl()}/`), true)
  // Scheme and host may arrive uppercased; the path may NOT — paths are
  // case-sensitive, so an uppercased one names a different resource.
  assert.equal(isCanonicalResource('HTTP://LOCALHOST:3000/api/mcp'), true)
  assert.equal(isCanonicalResource('http://localhost:3000/API/MCP'), false)
  // The whole point: a token must never be minted for somebody else's server.
  assert.equal(isCanonicalResource('https://someone-else.example/api/mcp'), false)
  assert.equal(isCanonicalResource(''), false)
})

// ── MCP 2026-07-28: Client ID Metadata Documents ──

test('a client_id is a metadata-document URL only when it is https with a path', () => {
  assert.equal(isClientIdUrl('https://app.example.com/oauth/client.json'), true)
  // Our own DCR identifiers must never be mistaken for one.
  assert.equal(isClientIdUrl('mcp_abc123'), false)
  assert.equal(isClientIdUrl('http://app.example.com/client.json'), false) // not https
  assert.equal(isClientIdUrl('https://app.example.com'), false) // no path component
  assert.equal(isClientIdUrl('https://app.example.com/'), false)
  assert.equal(isClientIdUrl('https://app.example.com/c.json#x'), false)
})

test('a metadata document is accepted only when it claims the URL it came from', () => {
  const url = 'https://app.example.com/oauth/client.json'
  const client = parseClientIdDocument(url, {
    client_id: url,
    client_name: 'Example MCP Client',
    client_uri: 'https://app.example.com',
    redirect_uris: ['http://127.0.0.1:3000/callback', 'http://localhost:3000/callback'],
  })
  assert.equal(client.clientId, url)
  assert.equal(client.clientName, 'Example MCP Client')
  assert.equal(client.source, 'client-id-document')
  assert.deepEqual(client.redirectUris, [
    'http://127.0.0.1:3000/callback',
    'http://localhost:3000/callback',
  ])

  // This equality check is the entire security model: it binds the document to
  // the origin that served it, so nobody can publish one for another's client_id.
  assert.throws(
    () =>
      parseClientIdDocument(url, {
        client_id: 'https://victim.example/oauth/client.json',
        client_name: 'Impostor',
        redirect_uris: ['https://attacker.example/cb'],
      }),
    ClientResolutionError,
  )
})

test('a metadata document missing a required property is rejected', () => {
  const url = 'https://app.example.com/oauth/client.json'
  const cases: unknown[] = [
    { client_id: url, redirect_uris: ['https://app.example.com/cb'] }, // no client_name
    { client_id: url, client_name: 'X' }, // no redirect_uris
    { client_id: url, client_name: 'X', redirect_uris: [] },
    'not an object',
    null,
    [],
  ]
  for (const doc of cases) {
    assert.throws(() => parseClientIdDocument(url, doc), ClientResolutionError)
  }
})

test('a metadata document cannot smuggle in a redirect URI we would refuse', () => {
  const url = 'https://app.example.com/oauth/client.json'
  assert.throws(
    () =>
      parseClientIdDocument(url, {
        client_id: url,
        client_name: 'X',
        redirect_uris: ['javascript:alert(1)'],
      }),
    ClientResolutionError,
  )
  // Declaring `web` and then asking for loopback is a contradiction (OIDC).
  assert.throws(
    () =>
      parseClientIdDocument(url, {
        client_id: url,
        client_name: 'X',
        application_type: 'web',
        redirect_uris: ['http://localhost:3000/cb'],
      }),
    ClientResolutionError,
  )
})

// ── MCP 2026-07-28: redirect URIs and application_type (SEP-837) ──

test('native clients may use loopback and private-use schemes; web clients may not', () => {
  assert.equal(validateRedirectUri('http://localhost:3000/callback', 'native').ok, true)
  assert.equal(validateRedirectUri('http://127.0.0.1:51763/cb', 'native').ok, true)
  assert.equal(validateRedirectUri('com.example.app:/oauth', 'native').ok, true)
  assert.equal(validateRedirectUri('https://claude.ai/api/mcp/auth_callback', 'native').ok, true)
  // Plain http to a remote host is never a valid redirect target.
  assert.equal(validateRedirectUri('http://evil.example/cb', 'native').ok, false)
  assert.equal(validateRedirectUri('javascript:alert(1)', 'native').ok, false)
  assert.equal(validateRedirectUri('https://app.example.com/cb#frag', 'native').ok, false)
  assert.equal(validateRedirectUri('/relative/cb', 'native').ok, false)

  assert.equal(validateRedirectUri('https://app.example.com/cb', 'web').ok, true)
  assert.equal(validateRedirectUri('http://localhost:3000/cb', 'web').ok, false)
  assert.equal(validateRedirectUri('http://app.example.com/cb', 'web').ok, false)
})

test('an omitted application_type is inferred, not defaulted to web', () => {
  // This is the SEP-837 failure mode: OIDC's `web` default would reject the
  // loopback URIs nearly every MCP client registers with.
  assert.equal(inferApplicationType(['http://localhost:3000/callback']), 'native')
  assert.equal(inferApplicationType(['com.example.app:/oauth']), 'native')
  assert.equal(inferApplicationType(['https://app.example.com/cb']), 'web')
  assert.equal(
    inferApplicationType(['https://app.example.com/cb', 'http://127.0.0.1:1234/cb']),
    'native',
  )
})

// ── MCP 2026-07-28: scope challenges / step-up ──

test('every tool maps to a scope in the catalogue, and reads outnumber writes', () => {
  const tools = Object.keys(TOOL_SCOPES)
  // 16 context/connector/agent tools + the nine Tool-authoring ones
  // (tests/mcp-scopes.test.ts pins those against what is actually registered).
  assert.equal(tools.length, 25)
  for (const scope of Object.values(TOOL_SCOPES)) {
    assert.ok(MCP_SCOPES.includes(scope), `${scope} is not in the catalogue`)
  }
  assert.equal(scopeForTool('edit_context'), 'context:write')
  assert.equal(scopeForTool('read_context'), 'context:read')
  // Reading an uploaded file is the same capability as reading a note about it.
  assert.equal(scopeForTool('list_files'), 'context:read')
  assert.equal(scopeForTool('read_file'), 'context:read')
  // A move rewrites other notes' links, so it is unambiguously a write.
  assert.equal(scopeForTool('move_context'), 'context:write')
  // The clean pass mutates in its apply/trash actions, so the whole tool
  // rides the write scope even though analysis is read-only.
  assert.equal(scopeForTool('clean_context'), 'context:write')
  // Editing the alias vocabulary is a write, and its list action rides along.
  assert.equal(scopeForTool('manage_alias'), 'context:write')
  // Connector discovery is a read; execution needs the dedicated scope.
  assert.equal(scopeForTool('list_connectors'), 'context:read')
  assert.equal(scopeForTool('run_connector'), 'connectors:use')
  // Same split for agents: the roster is a read; triggering a run needs its own scope.
  assert.equal(scopeForTool('list_agents'), 'context:read')
  assert.equal(scopeForTool('run_agent'), 'agents:run')
  assert.equal(scopeForTool('no_such_tool'), null)
})

test('a read-only token calling a write tool is challenged for the missing scope', () => {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'edit_context', arguments: {} },
  })
  assert.deepEqual(missingScopesForBody(body, ['context:read']), ['context:write'])
  assert.deepEqual(missingScopesForBody(body, ['context:read', 'context:write']), [])
})

test('a batch is challenged once, for the union of what it needs', () => {
  const body = JSON.stringify([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'edit_context' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'append_context' } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_context' } },
  ])
  // Deduped: one challenge, not one per call — the spec is explicit that
  // trickling out scopes forces needless authorization round-trips.
  assert.deepEqual(missingScopesForBody(body, []), ['context:write', 'context:read'])
})

test('non-tool traffic and unknown tools are never scope-challenged', () => {
  // tools/list must stay reachable, or the client cannot discover anything.
  assert.deepEqual(
    missingScopesForBody(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), []),
    [],
  )
  // An unknown tool is the handler's error to report, not a scope failure.
  assert.deepEqual(
    missingScopesForBody(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nope' } }),
      [],
    ),
    [],
  )
  assert.deepEqual(missingScopesForBody('not json', []), [])
})

// ── MCP 2026-07-28: discovery metadata ──

test('the discovery documents advertise the 2026-07-28 capabilities', () => {
  const as = authorizationServerMetadata()
  assert.equal(as.client_id_metadata_document_supported, true)
  assert.equal(as.authorization_response_iss_parameter_supported, true)
  assert.equal(as.issuer, 'http://localhost:3000')
  assert.deepEqual(as.code_challenge_methods_supported, ['S256'])
  // DCR stays advertised — deprecated, not removed.
  assert.ok(typeof as.registration_endpoint === 'string')

  const pr = protectedResourceMetadata()
  assert.equal(pr.resource, mcpResourceUrl())
  assert.deepEqual(pr.authorization_servers, [as.issuer])
  assert.deepEqual(pr.scopes_supported, [...MCP_SCOPES])
})

test('the server identity carries an absolute logo URL, not a build-hashed one', () => {
  const info = mcpServerInfo()
  assert.equal(info.name, 'visvine')
  assert.equal(info.websiteUrl, 'http://localhost:3000')

  const [icon, ...rest] = info.icons ?? []
  assert.deepEqual(rest, [])
  // A client fetches this cross-origin and unauthenticated, so it must be an
  // absolute URL to a literal file under public/ — never Next's hashed
  // app/icon.png route, whose name changes with the build.
  assert.equal(icon?.src, 'http://localhost:3000/images/brand-icon.png')
  assert.equal(icon?.mimeType, 'image/png')
  assert.ok(existsSync(new URL('../public/images/brand-icon.png', import.meta.url)))
})

test('an access token round-trips with its identity and scopes', async () => {
  const { token, expiresIn } = await mintAccessToken(
    IDENTITY,
    ['context:read', 'context:write'],
    'mcp_client_1',
  )
  assert.equal(expiresIn, 3600)

  const verified = await verifyAccessToken(token)
  assert.ok(verified)
  assert.equal(verified.userId, 'user_1')
  assert.equal(verified.email, 'test@local.dev')
  assert.equal(verified.clientId, 'mcp_client_1')
  assert.deepEqual(verified.scopes, ['context:read', 'context:write'])
})

test('a web session JWT cannot be replayed as an MCP access token', async () => {
  // Same secret, same audience — the only thing separating them is `typ`.
  const sessionJwt = await new SignJWT({ name: 'Test User', email: 'test@local.dev' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('user_1')
    .setAudience(mcpResourceUrl())
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET))

  assert.equal(await verifyAccessToken(sessionJwt), null)
})

test('a token minted for another audience is rejected', async () => {
  const foreign = await new SignJWT({ typ: 'mcp_access', scope: serializeScopes(MCP_SCOPES) })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('user_1')
    .setAudience('https://someone-else.example/api/mcp')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET))

  assert.equal(await verifyAccessToken(foreign), null)
})

test('garbage and tampered tokens verify as null', async () => {
  assert.equal(await verifyAccessToken('not-a-jwt'), null)
  const { token } = await mintAccessToken(IDENTITY, ['context:read'], 'mcp_client_1')
  assert.equal(await verifyAccessToken(`${token}x`), null)
})

test('PKCE S256 accepts the matching verifier and nothing else', () => {
  // Challenge for the verifier below, per RFC 7636 appendix B.
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
  assert.equal(verifyPkceS256(verifier, challenge), true)
  assert.equal(verifyPkceS256('wrong-verifier', challenge), false)
  // Length mismatch must not throw (timingSafeEqual requires equal lengths).
  assert.equal(verifyPkceS256(verifier, 'short'), false)
})

test('the mention string resolves to the entity from a note in ANY folder', () => {
  const mention = mentionFor('Craig Piggott', 'people/craig-piggott.md')
  assert.equal(mention, '[Craig Piggott](/people/craig-piggott.md)')

  // The whole point of the leading slash: a mention has to resolve the same
  // from the context root and from arbitrarily deep inside it.
  for (const from of ['inbox.md', 'deals/acme.md', 'a/b/c/deep.md']) {
    assert.deepEqual(
      entityMentionPaths(from, `We met ${mention} today.`),
      ['people/craig-piggott.md'],
      `mention did not resolve from ${from}`,
    )
  }
})

test('a mention WITHOUT the leading slash silently resolves to nothing', () => {
  // Regression guard: this is the form that looks right, draws no edge, and
  // reports no error — which is why the tools hand back `mention` instead.
  assert.deepEqual(
    entityMentionPaths('deals/acme.md', 'We met [Craig](people/craig-piggott.md) today.'),
    [],
  )
  // ...and it happens to work from the root, which is what makes it so easy to
  // believe the relative form is fine.
  assert.deepEqual(entityMentionPaths('inbox.md', 'We met [Craig](people/craig-piggott.md).'), [
    'people/craig-piggott.md',
  ])
})

test('person, space, resource and event are creatable from the context layer', () => {
  assert.deepEqual([...CREATABLE_TYPES], ['person', 'space', 'resource', 'event'])
  assert.equal(isCreatableType('person'), true)
  assert.equal(isCreatableType('space'), true)
  // The retired organisation spellings are NOT creatable ids — callers must
  // send the canonical type, which is what the zod enum on add_context takes.
  assert.equal(isCreatableType('group'), false)
  assert.equal(isCreatableType('organization'), false)
  assert.equal(isCreatableType('community'), false)
  assert.equal(isCreatableType('resource'), true)
  // An event starts as a context note like everything else; its date and RSVP
  // settings are edited on the event page afterwards.
  assert.equal(isCreatableType('event'), true)
  // Structural/admin types stay out.
  assert.equal(isCreatableType('channel'), false)
  assert.equal(isCreatableType('section'), false)
  assert.equal(isCreatableType('note'), false)
})

// ── The type catalog list_context exposes ──

const catalog = (over: Partial<Parameters<typeof buildTypeCatalog>[0]> = {}) =>
  buildTypeCatalog({
    featureConfig: null,
    isAdmin: true,
    usageByType: {},
    creatableTypes: CREATABLE_TYPES,
    ...over,
  })

test('the type catalog covers the whole closed vocabulary with the right creatable set', () => {
  const entries = catalog({ usageByType: { person: 3, connector: 1 } })
  assert.deepEqual(
    entries.map((e) => e.type),
    ['person', 'space', 'event', 'resource', 'section', 'channel', 'connector', 'agent', 'tool', 'index'],
  )
  const creatable = entries.filter((e) => e.creatable_via_add_context).map((e) => e.type)
  // Catalog order, not CREATABLE_TYPES order: an event is creatable now (it
  // starts as a context note like everything else) and sits where the closed
  // vocabulary puts it.
  assert.deepEqual(creatable, ['person', 'space', 'event', 'resource'])
  // Connector is enabled by default but NEVER creatable from add_context —
  // its only door is an admin-authored note under connectors/.
  const connector = entries.find((e) => e.type === 'connector')!
  assert.equal(connector.enabled, true)
  assert.equal(connector.creatable_via_add_context, false)
  assert.match(connector.guidance, /run_connector/)
  assert.equal(connector.usage_count, 1)
  // Agent is note-first like connector and never creatable from add_context
  // (agents/ is frozen for AI origins) — but member-writable, not admin-only.
  const agent = entries.find((e) => e.type === 'agent')!
  assert.equal(agent.enabled, true)
  assert.equal(agent.creatable_via_add_context, false)
  assert.match(agent.guidance, /run_agent/)
  assert.equal(agent.note_dir, 'agents')
  // Tool is note-first too, and folder-only: its entity note is the folder index
  // under tools/, never creatable via add_context (tools/ is frozen for AI).
  const tool = entries.find((e) => e.type === 'tool')!
  assert.equal(tool.enabled, true)
  assert.equal(tool.feature, 'tools')
  assert.equal(tool.creatable_via_add_context, false)
  assert.equal(tool.note_dir, 'tools')
  assert.match(tool.guidance, /tools\/<name>\/index\.md/)
  // Person carries the identity-matching field keys an agent must spell exactly.
  const person = entries.find((e) => e.type === 'person')!
  const keys = person.fields.map((f) => f.key)
  for (const k of ['email', 'companyName', 'linkedinUrl']) assert.ok(keys.includes(k), k)
  assert.equal(person.note_dir, 'people')
  assert.equal(person.usage_count, 3)
})

test('switching a feature off disables its node types, with the feature named', () => {
  const entries = catalog({ featureConfig: { enabled: { channels: false, connectors: false } } })
  for (const type of ['section', 'channel']) {
    const e = entries.find((x) => x.type === type)!
    assert.equal(e.enabled, false)
    assert.equal(e.feature, 'channels')
    assert.match(e.disabled_reason!, /'channels'/)
    assert.equal(e.creatable_via_add_context, false)
  }
  // Always-on types are untouched by any config — 'space' (the org type)
  // must never be gated behind channels.
  for (const type of ['person', 'space', 'event', 'index']) {
    const e = entries.find((x) => x.type === type)!
    assert.equal(e.enabled, true)
    assert.equal(e.disabled_reason, null)
    assert.equal(e.feature, null)
  }
})

test('a non-admin is told the connector door is closed to them', () => {
  const admin = catalog().find((e) => e.type === 'connector')!
  const member = catalog({ isAdmin: false }).find((e) => e.type === 'connector')!
  assert.ok(!admin.guidance.includes('not an admin'))
  assert.match(member.guidance, /not an admin/)
})

test('type filters canonicalise, so a search for a retired spelling still finds the rows', () => {
  // list_context compares canonical to canonical — every org spelling,
  // 'space' included, lands on 'space' now.
  assert.equal(canonicalNodeType('Org'), 'space')
  assert.equal(canonicalNodeType('GROUP'), 'space')
  assert.equal(canonicalNodeType('space'), 'space')
  assert.equal(canonicalNodeType('space'), 'space')
  assert.equal(canonicalNodeType('person'), 'person')
  assert.equal(canonicalNodeType(undefined), '')
  // …and search_context queries every spelling, because stored node.type is
  // whatever was current when the row was written.
  const spellings = nodeTypeSpellings('org')
  assert.ok(spellings.includes('space'))
  assert.ok(spellings.includes('space'))
  assert.ok(spellings.includes('group'))
  assert.ok(spellings.includes('organization'))
  assert.deepEqual(nodeTypeSpellings('person'), ['person'])
  assert.deepEqual(nodeTypeSpellings(''), [])
})
