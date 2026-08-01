// The connectors feature's pure layer: secret crypto roundtrips, frontmatter →
// config parsing, the allowlist grammar, secret-ref interpolation + redaction,
// the read-only SQL statement guard, and the shared SSRF address table.
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/connectors.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
import { encryptSecret, decryptSecret } from '@/lib/crypto/secrets'
import {
  parseConnectorConfig,
  parseAllowRule,
  matchAllowlist,
  normalizeRequestPath,
  findSecretRefs,
  interpolateSecrets,
  redactSecrets,
  isValidSecretName,
  newConnectorNote,
  type AllowRule,
} from '@/lib/connectors/config'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { assertSingleReadOnlyStatement } from '@/lib/connectors/postgres'
import { isPrivateAddress } from '@/lib/net/ssrf'

// Read lazily inside getSecretsKey, so setting it after imports is enough.
process.env.SECRETS_KEY ??= 'ab'.repeat(32)

// ── crypto ──

test('a secret roundtrips through encrypt/decrypt', () => {
  const stored = encryptSecret('sk_live_abc123')
  assert.match(stored, /^aes256gcm\$[0-9a-f]{24}\$[0-9a-f]{32}\$/)
  assert.equal(decryptSecret(stored), 'sk_live_abc123')
  // A fresh IV every time: two encryptions of one value must differ.
  assert.notEqual(encryptSecret('x'), encryptSecret('x'))
})

test('tampered ciphertext fails the auth tag', () => {
  const stored = encryptSecret('value')
  const parts = stored.split('$')
  const flipped = parts[3].startsWith('0') ? '1' + parts[3].slice(1) : '0' + parts[3].slice(1)
  assert.throws(() => decryptSecret([parts[0], parts[1], parts[2], flipped].join('$')))
  assert.throws(() => decryptSecret('scrypt$aa$bb'), /Unrecognized/)
})

test('a bad SECRETS_KEY throws at call time, not import time', () => {
  const saved = process.env.SECRETS_KEY
  try {
    process.env.SECRETS_KEY = 'too-short'
    assert.throws(() => encryptSecret('x'), /SECRETS_KEY/)
    delete process.env.SECRETS_KEY
    assert.throws(() => encryptSecret('x'), /SECRETS_KEY/)
  } finally {
    process.env.SECRETS_KEY = saved
  }
})

// ── config parsing ──

test('a valid http connector parses, with clamped defaults', () => {
  const parsed = parseConnectorConfig({
    type: 'connector',
    alias: 'http',
    base_url: 'https://api.stripe.com/',
    headers: { Authorization: 'Bearer {{secret:STRIPE_KEY}}' },
    allow: ['GET /v1/customers*', 'POST /v1/search'],
  })
  assert.ok(parsed.ok)
  assert.equal(parsed.config.alias, 'http')
  if (parsed.config.alias !== 'http') return
  assert.equal(parsed.config.baseUrl, 'https://api.stripe.com') // trailing slash stripped
  assert.equal(parsed.config.timeoutMs, 10_000)
  assert.deepEqual(parsed.config.allow, [
    { method: 'GET', path: '/v1/customers', prefix: true },
    { method: 'POST', path: '/v1/search', prefix: false },
  ])
})

test('a valid postgres connector parses; raw DSNs are refused', () => {
  const parsed = parseConnectorConfig({ alias: 'postgres', dsn: '{{secret:ANALYTICS_DSN}}', max_rows: 5000 })
  assert.ok(parsed.ok)
  if (!parsed.ok || parsed.config.alias !== 'postgres') return
  assert.equal(parsed.config.maxRows, 1000) // clamped

  for (const dsn of [
    'postgres://user:pass@db.example.com/app', // the whole point
    'postgres://{{secret:DSN}}', // partial ref
    '{{secret:A}}{{secret:B}}', // two refs
    '',
  ]) {
    const bad = parseConnectorConfig({ alias: 'postgres', dsn })
    assert.ok(!bad.ok, `should refuse dsn: ${dsn}`)
  }
})

test('config validation catches the dangerous shapes', () => {
  assert.ok(!parseConnectorConfig({}).ok) // no alias
  assert.ok(!parseConnectorConfig({ alias: 'graphql' }).ok) // unknown alias
  assert.ok(!parseConnectorConfig({ alias: 'http', base_url: 'not-a-url' }).ok)
  assert.ok(!parseConnectorConfig({ alias: 'http', base_url: 'http://api.example.com' }).ok) // https only outside dev
  assert.ok(!parseConnectorConfig({ alias: 'http', base_url: 'https://x.com?a=1' }).ok) // query string
  // Secret refs may not steer the host the SSRF check judges.
  assert.ok(!parseConnectorConfig({ alias: 'http', base_url: 'https://{{secret:HOST}}' }).ok)
  assert.ok(!parseConnectorConfig({ alias: 'http', base_url: 'https://x.com', allow: ['GET'] }).ok) // malformed rule
  assert.ok(!parseConnectorConfig({ alias: 'http', base_url: 'https://x.com', headers: { A: 1 } as never }).ok)

  // No allow list is VALID — a describe-only connector.
  const docsOnly = parseConnectorConfig({ alias: 'http', base_url: 'https://x.com' })
  assert.ok(docsOnly.ok)
  if (docsOnly.ok && docsOnly.config.alias === 'http') assert.deepEqual(docsOnly.config.allow, [])
})

// ── the note the Create panel writes ──
// The panel's whole safety property: whatever newConnectorNote emits must parse,
// or an admin gets a connector flagged invalid the moment they create it.

test('newConnectorNote emits an http connector that parses back', () => {
  const note = newConnectorNote({
    name: 'stripe',
    alias: 'http',
    description: 'Billing — customers and charges',
    baseUrl: 'https://api.stripe.com/v1/',
    allow: ['GET /customers', 'GET /customers/*', 'POST /customers'],
  })
  const fm = parseFrontmatter(note)
  assert.equal(fm.type, 'connector')
  assert.equal(fm.alias, 'http')

  const parsed = parseConnectorConfig(fm)
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  if (!parsed.ok || parsed.config.alias !== 'http') return
  // The trailing slash is stripped, so paths don't end up doubled.
  assert.equal(parsed.config.baseUrl, 'https://api.stripe.com/v1')
  assert.equal(parsed.config.allow.length, 3)
  assert.ok(matchAllowlist(parsed.config.allow, 'GET', '/customers/cus_1'))
  assert.ok(!matchAllowlist(parsed.config.allow, 'DELETE', '/customers/cus_1'))
})

test('newConnectorNote emits a docs-only http connector when no calls are allowed', () => {
  const parsed = parseConnectorConfig(parseFrontmatter(
    newConnectorNote({ name: 'docs', alias: 'http', baseUrl: 'https://api.example.com', allow: [] }),
  ))
  assert.ok(parsed.ok)
  if (parsed.ok && parsed.config.alias === 'http') assert.deepEqual(parsed.config.allow, [])
})

test('newConnectorNote emits a postgres connector whose dsn is one secret ref', () => {
  const note = newConnectorNote({ name: 'appdb', alias: 'postgres', secretName: 'appdb_dsn' })
  // A raw connection string must never reach the note.
  assert.ok(!/postgres(ql)?:\/\//.test(note))

  const parsed = parseConnectorConfig(parseFrontmatter(note))
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  if (!parsed.ok || parsed.config.alias !== 'postgres') return
  assert.deepEqual(findSecretRefs(parsed.config.dsn), ['APPDB_DSN']) // upper-cased for the store
})

// ── allowlist grammar ──

const rules = (raws: string[]): AllowRule[] => raws.map((r) => parseAllowRule(r)!).filter(Boolean)

test('allowlist: exact, prefix and one-segment wildcard matching', () => {
  const allow = rules(['GET /v1/customers*', 'GET /v1/charges/*', 'POST /v1/search'])
  assert.ok(matchAllowlist(allow, 'GET', '/v1/customers'))
  assert.ok(matchAllowlist(allow, 'get', '/v1/customers/cus_1')) // prefix + method case
  assert.ok(matchAllowlist(allow, 'GET', '/v1/charges/ch_1')) // one segment
  assert.ok(!matchAllowlist(allow, 'GET', '/v1/charges/ch_1/refunds')) // two segments ≠ one
  assert.ok(!matchAllowlist(allow, 'GET', '/v1/charges/')) // empty segment
  assert.ok(matchAllowlist(allow, 'POST', '/v1/search'))
  assert.ok(!matchAllowlist(allow, 'DELETE', '/v1/search')) // wrong method
  assert.ok(!matchAllowlist(allow, 'POST', '/v1/search/deep')) // exact means exact
  assert.ok(!matchAllowlist([], 'GET', '/anything')) // empty list denies everything
})

test('path normalization refuses traversal and encoding tricks', () => {
  assert.equal(normalizeRequestPath('/v1/customers'), '/v1/customers')
  assert.equal(normalizeRequestPath('v1/customers'), null) // must be absolute
  assert.equal(normalizeRequestPath('/v1/../admin'), null)
  assert.equal(normalizeRequestPath('/v1//admin'), null)
  assert.equal(normalizeRequestPath('/v1/%2e%2e/admin'), null)
  assert.equal(normalizeRequestPath('/v1/%2Fadmin'), null)
  assert.equal(normalizeRequestPath('/v1/\\admin'), null)
})

// ── secret refs, interpolation, redaction ──

test('findSecretRefs and name validation', () => {
  assert.deepEqual(findSecretRefs('Bearer {{secret:KEY_A}} and {{secret:KEY_B}} and {{secret:KEY_A}}'), [
    'KEY_A',
    'KEY_B',
  ])
  assert.deepEqual(findSecretRefs('no refs here'), [])
  assert.ok(isValidSecretName('STRIPE_KEY'))
  assert.ok(!isValidSecretName('stripe_key'))
  assert.ok(!isValidSecretName('1KEY'))
  assert.ok(!isValidSecretName(''))
})

test('interpolation fills every ref or reports exactly what is missing', () => {
  const secrets = new Map([['KEY_A', 'aaa']])
  const ok = interpolateSecrets('Bearer {{secret:KEY_A}}', secrets)
  assert.deepEqual(ok, { ok: true, value: 'Bearer aaa' })
  const missing = interpolateSecrets('{{secret:KEY_A}}:{{secret:KEY_B}}', new Map())
  assert.ok(!missing.ok)
  if (!missing.ok) assert.deepEqual(missing.missing, ['KEY_A', 'KEY_B'])
})

test('redaction strips secret values from anything bound for the model', () => {
  // The scenario that matters: an upstream echoing its Authorization header.
  const echoed = '{"headers":{"Authorization":"Bearer sk_live_abc123"},"error":"bad key sk_live_abc123"}'
  const clean = redactSecrets(echoed, ['sk_live_abc123'])
  assert.ok(!clean.includes('sk_live_abc123'))
  assert.equal(clean.split('[redacted]').length, 3)
  assert.equal(redactSecrets('untouched', ['']), 'untouched') // empty value must not explode
})

// ── read-only SQL guard ──

test('the SQL guard accepts single read statements', () => {
  for (const sql of [
    'select 1',
    'SELECT * FROM users WHERE name = $1',
    'select 1;', // trailing semicolon fine
    "select ';' as tricky", // semicolon inside a string
    "select 'it''s' as escaped",
    'select $tag$ ; drop table x $tag$ as dollar_quoted',
    'select 1 -- comment with ; in it',
    'select 1 /* block ; comment */',
    'with t as (select 1) select * from t',
    '(select 1)',
    'explain select * from users',
    'values (1), (2)',
    'table users',
    'show server_version',
  ]) {
    assert.doesNotThrow(() => assertSingleReadOnlyStatement(sql), `should accept: ${sql}`)
  }
})

test('the SQL guard rejects writes and multi-statements', () => {
  for (const sql of [
    'select 1; drop table users',
    'drop table users',
    'insert into users values (1)',
    'update users set name = $1',
    'delete from users',
    'copy users to stdout',
    'do $$ begin end $$',
    'create table x (id int)',
    'truncate users',
    'grant all on users to public',
    '',
  ]) {
    assert.throws(() => assertSingleReadOnlyStatement(sql), `should reject: ${sql}`)
  }
})

// ── SSRF address table ──

test('isPrivateAddress knows the non-routable space', () => {
  for (const addr of [
    '10.0.0.1',
    '127.0.0.1',
    '0.0.0.0',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', // CGNAT
    '224.0.0.1', // multicast
    '::',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd12::1',
    'ff02::1',
    '::ffff:10.0.0.1', // IPv4-mapped
    'not-an-ip',
  ]) {
    assert.ok(isPrivateAddress(addr), `${addr} should be private`)
  }
  for (const addr of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) {
    assert.ok(!isPrivateAddress(addr), `${addr} should be public`)
  }
})
