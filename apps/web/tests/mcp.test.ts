// Unit tests for the MCP server's pure layers: the scope catalogue, access-token
// mint/verify (including the guard that stops a web session JWT being replayed
// as an MCP token), PKCE verification, and the creatable-type rule that decides
// what the context layer can make.
//
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/mcp.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
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
import { mcpResourceUrl, canonicalizeResource, isCanonicalResource } from '@/lib/mcp/config'
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
import { entityMentionPaths } from '@/lib/notes/entities'

// Both the signing secret and the token audience are read lazily, inside the
// functions under test, so setting them after the imports is enough.
process.env.AUTH_SECRET ??= 'test-secret-for-mcp-tests'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const IDENTITY = { userId: 'user_1', name: 'Test User', email: 'test@local.dev', personId: null }

test('the catalogue is the two context scopes plus connectors:use', () => {
  assert.deepEqual([...MCP_SCOPES], ['context:read', 'context:write', 'connectors:use'])
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
  assert.equal(tools.length, 10)
  for (const scope of Object.values(TOOL_SCOPES)) {
    assert.ok(MCP_SCOPES.includes(scope), `${scope} is not in the catalogue`)
  }
  assert.equal(scopeForTool('write_note'), 'context:write')
  assert.equal(scopeForTool('get_entity'), 'context:read')
  // Connector discovery is a read; execution needs the dedicated scope.
  assert.equal(scopeForTool('list_connectors'), 'context:read')
  assert.equal(scopeForTool('call_connector'), 'connectors:use')
  assert.equal(scopeForTool('query_connector'), 'connectors:use')
  assert.equal(scopeForTool('no_such_tool'), null)
})

test('a read-only token calling a write tool is challenged for the missing scope', () => {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'write_note', arguments: {} },
  })
  assert.deepEqual(missingScopesForBody(body, ['context:read']), ['context:write'])
  assert.deepEqual(missingScopesForBody(body, ['context:read', 'context:write']), [])
})

test('a batch is challenged once, for the union of what it needs', () => {
  const body = JSON.stringify([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'write_note' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'append_note' } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_entity' } },
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

test('only person, group and resource are creatable from the context layer', () => {
  assert.deepEqual([...CREATABLE_TYPES], ['person', 'group', 'resource'])
  assert.equal(isCreatableType('person'), true)
  assert.equal(isCreatableType('group'), true)
  assert.equal(isCreatableType('resource'), true)
  // Events go through the events surface; these are structural/admin types.
  assert.equal(isCreatableType('event'), false)
  assert.equal(isCreatableType('channel'), false)
  assert.equal(isCreatableType('space'), false)
  assert.equal(isCreatableType('note'), false)
})
