// Runtime-stamped connector identity: frontmatter parsing, host scoping, the
// minted assertion's claims, and — the part that matters — that isolate code
// cannot forge, shadow or read it.
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/connector-identity.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
import { jwtVerify, decodeProtectedHeader } from 'jose'
import {
  identityAppliesTo,
  identitySecretName,
  mintActorAssertion,
  parseConnectorIdentity,
  type ResolvedIdentity,
} from '@/lib/connectors/identity'
import { parseConnectorPerimeter, perimeterSecretRefs } from '@/lib/connectors/config'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'

const SECRET = 'a-signing-key-shared-with-one-upstream'

function resolved(over: Partial<ResolvedIdentity> = {}): ResolvedIdentity {
  return {
    header: 'x-actor-assertion',
    audience: 'blackbird-data',
    secret: SECRET,
    ttlSeconds: 120,
    hosts: [],
    actorEmail: 'person@example.com',
    ...over,
  }
}

function fm(body: string) {
  return parseFrontmatter(`---\n${body}\n---\nbody\n`)
}

test('identity: absent parses to null, present parses fully', () => {
  const absent = parseConnectorIdentity(undefined)
  assert.ok(absent.ok)
  assert.equal(absent.identity, null)

  const parsed = parseConnectorIdentity({
    audience: 'blackbird-data',
    secret: '{{secret:ACTOR_KEY}}',
    header: 'X-Actor-Assertion',
    ttl_s: 300,
    hosts: ['Api.Example.COM.'],
  })
  assert.ok(parsed.ok)
  assert.deepEqual(parsed.identity, {
    header: 'x-actor-assertion',
    audience: 'blackbird-data',
    secretRef: '{{secret:ACTOR_KEY}}',
    ttlSeconds: 300,
    hosts: ['api.example.com'],
  })
})

test('identity: a literal signing key is refused — notes carry references, never credentials', () => {
  const bad = parseConnectorIdentity({ audience: 'x', secret: 'sk-live-abc123' })
  assert.ok(!bad.ok)
  assert.match(bad.error, /must be exactly one \{\{secret:NAME\}\} reference/)

  // Half a reference is not a reference.
  assert.ok(!parseConnectorIdentity({ audience: 'x', secret: 'Bearer {{secret:K}}' }).ok)
})

test('identity: audience is required, and ttl is bounded', () => {
  assert.ok(!parseConnectorIdentity({ secret: '{{secret:K}}' }).ok)
  assert.ok(!parseConnectorIdentity({ audience: 'x', secret: '{{secret:K}}', ttl_s: 5 }).ok)
  assert.ok(!parseConnectorIdentity({ audience: 'x', secret: '{{secret:K}}', ttl_s: 86_400 }).ok)
  assert.ok(parseConnectorIdentity({ audience: 'x', secret: '{{secret:K}}', ttl_s: 120 }).ok)
})

test('identity: a malformed block is an error, never a silent skip', () => {
  // A note that means to attest identity and quietly does not would send a
  // shared-robot request that reads as per-user.
  assert.ok(!parseConnectorIdentity('nope').ok)
  assert.ok(!parseConnectorIdentity([{ audience: 'x' }]).ok)
  assert.ok(!parseConnectorIdentity({ audience: 'x', secret: '{{secret:K}}', header: 'bad header' }).ok)
})

test('perimeter: the identity block rides frontmatter and its secret is resolved with the rest', () => {
  const parsed = parseConnectorPerimeter(
    fm(
      [
        'type: connector',
        'hosts:',
        '  - api.example.com',
        'env:',
        '  API_KEY: "{{secret:API_KEY}}"',
        'identity:',
        '  audience: blackbird-data',
        '  secret: "{{secret:ACTOR_KEY}}"',
      ].join('\n'),
    ),
  )
  assert.ok(parsed.ok)
  assert.equal(parsed.perimeter.identity?.audience, 'blackbird-data')
  assert.equal(identitySecretName(parsed.perimeter.identity!), 'ACTOR_KEY')

  // Both names must be resolved for the run, or the stamp silently never happens.
  assert.deepEqual(perimeterSecretRefs(parsed.perimeter).sort(), ['ACTOR_KEY', 'API_KEY'])
})

test('perimeter: a connector without an identity block is unaffected', () => {
  const parsed = parseConnectorPerimeter(fm(['hosts:', '  - api.example.com'].join('\n')))
  assert.ok(parsed.ok)
  assert.equal(parsed.perimeter.identity, null)
  assert.deepEqual(perimeterSecretRefs(parsed.perimeter), [])
})

test('perimeter: a bad identity block fails the whole parse', () => {
  const parsed = parseConnectorPerimeter(
    fm(['hosts: []', 'identity:', '  audience: x', '  secret: literal-key'].join('\n')),
  )
  assert.ok(!parsed.ok)
})

test('applies-to: no actor means nothing is stamped', () => {
  // An agent or maintenance run acts for no one. The upstream then sees an
  // unattributed call, which is its restrictive path.
  assert.equal(identityAppliesTo(resolved({ actorEmail: '' }), 'api.example.com', 443, 443), false)
})

test('applies-to: empty hosts covers the whole perimeter, a list narrows it', () => {
  assert.equal(identityAppliesTo(resolved(), 'anything.example.com', 443, 443), true)

  const narrowed = resolved({ hosts: ['blackbird.example.com'] })
  assert.equal(identityAppliesTo(narrowed, 'blackbird.example.com', 443, 443), true)
  // A multi-vendor note must not hand the user's email to the other vendor.
  assert.equal(identityAppliesTo(narrowed, 'api.stripe.com', 443, 443), false)
})

test('applies-to: a port-qualified entry pins that port', () => {
  const pinned = resolved({ hosts: ['db.example.com:5432'] })
  assert.equal(identityAppliesTo(pinned, 'db.example.com', 5432, 5432), true)
  assert.equal(identityAppliesTo(pinned, 'db.example.com', 5433, 5432), false)
})

test('mint: the assertion names the actor, binds the audience and expires', async () => {
  const before = Math.floor(Date.now() / 1000)
  const jws = await mintActorAssertion(resolved())

  assert.equal(decodeProtectedHeader(jws).alg, 'HS256')

  const { payload } = await jwtVerify(jws, new TextEncoder().encode(SECRET), {
    audience: 'blackbird-data',
  })
  assert.equal(payload.sub, 'person@example.com')
  assert.ok(typeof payload.exp === 'number' && typeof payload.iat === 'number')
  // Short-lived by construction: a copy that escapes is useless in minutes.
  assert.ok(payload.exp - payload.iat === 120)
  assert.ok(payload.iat >= before)
})

test('mint: an assertion does not verify against a different key or audience', async () => {
  const jws = await mintActorAssertion(resolved())

  await assert.rejects(() => jwtVerify(jws, new TextEncoder().encode('wrong-key')))
  await assert.rejects(() =>
    jwtVerify(jws, new TextEncoder().encode(SECRET), { audience: 'some-other-api' }),
  )
})
