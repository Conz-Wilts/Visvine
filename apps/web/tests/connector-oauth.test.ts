// Connector OAuth: the `auth:` block, PKCE, the pending-authorization cookie,
// and the mode rules that decide whose account a run spends.
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/connector-oauth.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
import { connectionOwner, parseConnectorAuth, authSecretRefs } from '@/lib/connectors/auth'
import { platformClientRef, resolvePlatformClient } from '@/lib/connectors/platformClients'
import { createPkce, randomState, statesMatch, authorizeUrl } from '@/lib/connectors/oauth'
import { readPending, signPending } from '@/lib/connectors/pending'
import { parseConnectorPerimeter, perimeterSecretRefs } from '@/lib/connectors/config'
import { parseAgentActivation, scheduleHash } from '@/lib/agents/config'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { createHash } from 'node:crypto'

process.env.AUTH_SECRET ||= 'test-secret-for-connector-oauth-tests'

function fm(body: string) {
  return parseFrontmatter(`---\n${body}\n---\nbody\n`)
}

const OK_BLOCK = {
  provider: 'notion',
  mode: 'user',
  discover: 'https://mcp.notion.com/mcp',
  scopes: ['read_content'],
}

// ── the auth block ────────────────────────────────────────────────────────────

test('auth: absent parses to null; a full block parses through', () => {
  const absent = parseConnectorAuth(undefined)
  assert.ok(absent.ok)
  assert.equal(absent.auth, null)

  const parsed = parseConnectorAuth(OK_BLOCK)
  assert.ok(parsed.ok)
  assert.equal(parsed.auth?.provider, 'notion')
  assert.equal(parsed.auth?.mode, 'user')
  assert.deepEqual(parsed.auth?.discovery, { kind: 'discover', url: 'https://mcp.notion.com/mcp' })
  assert.deepEqual(parsed.auth?.scopes, ['read_content'])
})

test('auth: mode must be stated — there is no safe default', () => {
  // `user` and `space` differ in who ends up able to act as whom. Guessing
  // either would be guessing at a privilege boundary.
  assert.ok(!parseConnectorAuth({ ...OK_BLOCK, mode: undefined }).ok)
  assert.ok(!parseConnectorAuth({ ...OK_BLOCK, mode: 'shared' }).ok)
  assert.ok(parseConnectorAuth({ ...OK_BLOCK, mode: 'space' }).ok)
})

test('auth: endpoints must be https and literal', () => {
  assert.ok(!parseConnectorAuth({ ...OK_BLOCK, discover: 'http://mcp.notion.com/mcp' }).ok)
  // A secret-interpolated endpoint would steer the flow past the note review
  // that the literal host list exists to enable.
  assert.ok(!parseConnectorAuth({ ...OK_BLOCK, discover: 'https://{{secret:HOST}}/mcp' }).ok)

  const explicit = parseConnectorAuth({
    provider: 'acme',
    mode: 'space',
    authorize_url: 'https://acme.test/authorize',
    token_url: 'https://acme.test/token',
  })
  assert.ok(explicit.ok)
  assert.equal(explicit.auth?.discovery.kind, 'explicit')

  // authorize_url without token_url is not a usable pair.
  assert.ok(!parseConnectorAuth({ provider: 'acme', mode: 'space', authorize_url: 'https://acme.test/a' }).ok)
})

test('auth: a literal client secret is refused', () => {
  const bad = parseConnectorAuth({ ...OK_BLOCK, client_secret: 'sk-live-abc' })
  assert.ok(!bad.ok)
  assert.match(bad.error, /\{\{secret:NAME\}\}/)

  const good = parseConnectorAuth({ ...OK_BLOCK, client_secret: '{{secret:NOTION_CLIENT_SECRET}}' })
  assert.ok(good.ok)
  assert.deepEqual(authSecretRefs(good.auth!), ['NOTION_CLIENT_SECRET'])
})

test('auth.params: parses a literal map, lowercases keys, defaults to empty', () => {
  const absent = parseConnectorAuth(OK_BLOCK)
  assert.ok(absent.ok)
  assert.deepEqual(absent.auth?.params, {})

  const parsed = parseConnectorAuth({ ...OK_BLOCK, params: { ACCESS_TYPE: 'offline', prompt: ' consent ' } })
  assert.ok(parsed.ok)
  assert.deepEqual(parsed.auth?.params, { access_type: 'offline', prompt: 'consent' })

  assert.ok(!parseConnectorAuth({ ...OK_BLOCK, params: ['offline'] }).ok)
  assert.ok(!parseConnectorAuth({ ...OK_BLOCK, params: 'access_type=offline' }).ok)
})

test('auth.params: reserved keys are refused by name', () => {
  for (const key of ['client_id', 'redirect_uri', 'state', 'code_challenge', 'scope', 'response_type']) {
    const bad = parseConnectorAuth({ ...OK_BLOCK, params: { [key]: 'evil' } })
    assert.ok(!bad.ok)
    assert.match(bad.error, new RegExp(key))
  }
})

test('auth.params: secret references, empty and oversize values are refused', () => {
  assert.ok(!parseConnectorAuth({ ...OK_BLOCK, params: { login_hint: '{{secret:EMAIL}}' } }).ok)
  assert.ok(!parseConnectorAuth({ ...OK_BLOCK, params: { login_hint: '' } }).ok)
  assert.ok(!parseConnectorAuth({ ...OK_BLOCK, params: { login_hint: 'x'.repeat(300) } }).ok)
  assert.ok(!parseConnectorAuth({ ...OK_BLOCK, params: { 'Bad Key!': 'x' } }).ok)
})

test('auth: a platform client_id refuses a client_secret alongside it', () => {
  const bad = parseConnectorAuth({ ...OK_BLOCK, client_id: 'platform:google', client_secret: '{{secret:X}}' })
  assert.ok(!bad.ok)
  assert.match(bad.error, /platform/)

  const good = parseConnectorAuth({ ...OK_BLOCK, client_id: 'platform:google' })
  assert.ok(good.ok)
  assert.equal(good.auth?.clientId, 'platform:google')
})

test('auth: scopes must be single tokens', () => {
  assert.ok(!parseConnectorAuth({ ...OK_BLOCK, scopes: ['read content'] }).ok)
  assert.ok(!parseConnectorAuth({ ...OK_BLOCK, scopes: 'read_content' }).ok)
})

test('perimeter: the auth block rides frontmatter and contributes its secrets', () => {
  const parsed = parseConnectorPerimeter(
    fm(
      [
        'type: connector',
        'hosts:',
        '  - mcp.notion.com',
        'env: {}',
        'auth:',
        '  provider: notion',
        '  mode: user',
        '  discover: https://mcp.notion.com/mcp',
        '  client_secret: "{{secret:NOTION_CLIENT_SECRET}}"',
      ].join('\n'),
    ),
  )
  assert.ok(parsed.ok)
  assert.equal(parsed.perimeter.auth?.provider, 'notion')
  assert.deepEqual(perimeterSecretRefs(parsed.perimeter), ['NOTION_CLIENT_SECRET'])
})

test('perimeter: a connector without an auth block is unaffected', () => {
  const parsed = parseConnectorPerimeter(fm(['hosts:', '  - api.stripe.com'].join('\n')))
  assert.ok(parsed.ok)
  assert.equal(parsed.perimeter.auth, null)
})

// ── whose connection ──────────────────────────────────────────────────────────

test('owner: space mode collapses everyone onto one row, user mode does not', () => {
  const userAuth = parseConnectorAuth(OK_BLOCK)
  const spaceAuth = parseConnectorAuth({ ...OK_BLOCK, mode: 'space' })
  assert.ok(userAuth.ok && spaceAuth.ok)

  assert.equal(connectionOwner(userAuth.auth!, 'user_a'), 'user_a')
  assert.equal(connectionOwner(userAuth.auth!, 'user_b'), 'user_b')

  // Empty string, not null: Postgres treats NULLs as distinct in a unique
  // index, so a nullable owner would allow two space connections to coexist.
  assert.equal(connectionOwner(spaceAuth.auth!, 'user_a'), '')
  assert.equal(connectionOwner(spaceAuth.auth!, 'user_b'), '')
})

// ── PKCE + state ──────────────────────────────────────────────────────────────

test('pkce: the challenge is the S256 of the verifier, and pairs are unique', () => {
  const a = createPkce()
  const b = createPkce()
  assert.notEqual(a.verifier, b.verifier)
  assert.equal(createHash('sha256').update(a.verifier).digest('base64url'), a.challenge)
})

test('state: compared in constant time, and mismatches are rejected', () => {
  const state = randomState()
  assert.ok(statesMatch(state, state))
  assert.ok(!statesMatch(state, randomState()))
  assert.ok(!statesMatch(state, state.slice(0, -1)))
  assert.ok(!statesMatch('', state))
})

test('authorize url: carries PKCE, state and the resource, never the verifier', () => {
  const { verifier, challenge } = createPkce()
  const url = new URL(
    authorizeUrl({
      endpoints: {
        issuer: 'https://acme.test',
        authorizationEndpoint: 'https://acme.test/authorize',
        tokenEndpoint: 'https://acme.test/token',
        registrationEndpoint: null,
        scopesSupported: [],
      },
      clientId: 'client-123',
      redirectUri: 'https://app.test/api/connectors/oauth/callback',
      scopes: ['read', 'write'],
      state: 'state-abc',
      challenge,
      resource: 'https://acme.test/mcp',
    }),
  )
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('code_challenge'), challenge)
  assert.equal(url.searchParams.get('scope'), 'read write')
  assert.equal(url.searchParams.get('resource'), 'https://acme.test/mcp')
  // The verifier is the whole point of PKCE — it must never leave the server.
  assert.ok(!url.toString().includes(verifier))
})

test('authorize url: extra params ride along and can never shadow the protocol', () => {
  const { challenge } = createPkce()
  const url = new URL(
    authorizeUrl({
      endpoints: {
        issuer: 'https://accounts.google.com',
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        registrationEndpoint: null,
        scopesSupported: [],
      },
      clientId: 'client-123',
      redirectUri: 'https://app.test/api/connectors/oauth/callback',
      scopes: ['a'],
      state: 'state-abc',
      challenge,
      // client_id here bypasses parse validation on purpose: even then the
      // protocol value must win.
      params: { access_type: 'offline', prompt: 'consent', client_id: 'evil' },
    }),
  )
  assert.equal(url.searchParams.get('access_type'), 'offline')
  assert.equal(url.searchParams.get('prompt'), 'consent')
  assert.equal(url.searchParams.get('client_id'), 'client-123')
})

// ── the platform client ───────────────────────────────────────────────────────

test('platform client: refs parse, resolve from env, and fail closed', () => {
  assert.equal(platformClientRef('platform:google'), 'google')
  assert.equal(platformClientRef('client-123'), null)
  assert.equal(platformClientRef(null), null)
  assert.equal(platformClientRef('platform:Not Valid'), null)

  const env = { GOOGLE_CLIENT_ID: 'id-1', GOOGLE_CLIENT_SECRET: 'sec-1' }
  assert.deepEqual(resolvePlatformClient('google', env), { clientId: 'id-1', clientSecret: 'sec-1' })
  // No secret is a public client, not a failure.
  assert.deepEqual(resolvePlatformClient('google', { GOOGLE_CLIENT_ID: 'id-1' }), { clientId: 'id-1', clientSecret: null })
  assert.equal(resolvePlatformClient('google', {}), null)
  assert.equal(resolvePlatformClient('unknown', env), null)
})

// ── the pending cookie ────────────────────────────────────────────────────────

const PENDING = {
  spaceId: 'space_1',
  connector: 'notion',
  provider: 'notion',
  mode: 'user' as const,
  userId: 'user_a',
  verifier: 'v-123',
  state: 's-456',
  scopes: ['read_content'],
}

test('pending: round-trips, and refuses anything unsigned or tampered', async () => {
  const token = await signPending(PENDING)
  assert.deepEqual(await readPending(token), PENDING)

  assert.equal(await readPending(undefined), null)
  assert.equal(await readPending('not-a-jwt'), null)
  // Flip a character in the payload: the signature no longer verifies.
  const parts = token.split('.')
  const tampered = `${parts[0]}.${Buffer.from(JSON.stringify({ ...PENDING, userId: 'user_b' })).toString('base64url')}.${parts[2]}`
  assert.equal(await readPending(tampered), null)
})

test('pending: a session cookie cannot be replayed as a pending authorization', async () => {
  const { SignJWT } = await import('jose')
  const sessionShaped = await new SignJWT({ userId: 'user_a', email: 'a@b.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET!))
  // Correctly signed with the same key — only the `typ` guard stops it.
  assert.equal(await readPending(sessionShaped), null)
})

// ── agent identity ────────────────────────────────────────────────────────────

test('agents: runs_as is read off the live note, and defaults to absent', () => {
  const plain = parseAgentActivation(fm('active: true\nschedule: daily\nat: "07:00"'))
  assert.ok(plain.ok)
  assert.equal(plain.activation.runsAs, null)

  const pointed = parseAgentActivation(
    fm('active: true\nschedule: daily\nat: "07:00"\nruns_as: user_service'),
  )
  assert.ok(pointed.ok)
  assert.equal(pointed.activation.runsAs, 'user_service')
})

test('agents: repointing runs_as does not reschedule the agent', () => {
  const a = parseAgentActivation(fm('active: true\nschedule: daily\nat: "07:00"'))
  const b = parseAgentActivation(fm('active: true\nschedule: daily\nat: "07:00"\nruns_as: user_x'))
  assert.ok(a.ok && b.ok)
  // scheduleHash drives dispatch. Whose credentials a run spends is not a
  // scheduling fact, and folding it in would re-plan every agent on an edit.
  assert.equal(scheduleHash(a.activation, 'UTC'), scheduleHash(b.activation, 'UTC'))
})
