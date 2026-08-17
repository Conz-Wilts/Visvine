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
  configSecretRefs,
  interpolateSecrets,
  redactSecrets,
  isValidSecretName,
  newConnectorNote,
  parseConnectorPerimeter,
  perimeterSecretRefs,
  type AllowRule,
} from '@/lib/connectors/config'
import { connectorKind, modelConnectorInfo, newModelConnectorNote, parseModelConnector } from '@/lib/connectors/model'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { isPrivateAddress } from '@/lib/net/ssrf'
import { assertSingleReadOnlyStatement } from '@/lib/connectors/postgres'
import { assertSingleReadOnlyMysqlStatement } from '@/lib/connectors/mysql'

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

test('a valid mysql connector parses with the same DSN rule as postgres', () => {
  const parsed = parseConnectorConfig({ alias: 'mysql', dsn: '{{secret:SHOP_DSN}}', max_rows: 50 })
  assert.ok(parsed.ok)
  if (!parsed.ok || parsed.config.alias !== 'mysql') return
  assert.equal(parsed.config.maxRows, 50)
  assert.deepEqual(configSecretRefs(parsed.config), ['SHOP_DSN'])
  assert.ok(!parseConnectorConfig({ alias: 'mysql', dsn: 'mysql://u:p@db.example.com/app' }).ok)
})

test('a valid mcp connector parses; bad tool rules and secret-ref urls are refused', () => {
  const parsed = parseConnectorConfig({
    alias: 'mcp',
    url: 'https://mcp.example.com/mcp',
    headers: { Authorization: 'Bearer {{secret:LINEAR_TOKEN}}' },
    allow: ['search_issues', 'get_*'],
  })
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  if (!parsed.ok || parsed.config.alias !== 'mcp') return
  assert.deepEqual(parsed.config.allow, ['search_issues', 'get_*'])
  assert.deepEqual(configSecretRefs(parsed.config), ['LINEAR_TOKEN'])

  assert.ok(!parseConnectorConfig({ alias: 'mcp', url: 'https://x.com/mcp', allow: ['bad tool'] }).ok)
  assert.ok(!parseConnectorConfig({ alias: 'mcp', url: 'https://{{secret:HOST}}/mcp' }).ok)
  assert.ok(!parseConnectorConfig({ alias: 'mcp', url: 'not-a-url' }).ok)
})


test('http oauth: client_secret must be one secret ref; refs are collected', () => {
  const parsed = parseConnectorConfig({
    alias: 'http',
    base_url: 'https://api.example.com',
    allow: ['GET /v1/things'],
    auth: {
      token_url: 'https://login.example.com/oauth/token',
      client_id: 'my-app',
      client_secret: '{{secret:CRM_CLIENT_SECRET}}',
      scope: 'read',
    },
  })
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  if (!parsed.ok || parsed.config.alias !== 'http') return
  assert.equal(parsed.config.oauth?.tokenUrl, 'https://login.example.com/oauth/token')
  assert.equal(parsed.config.oauth?.scope, 'read')
  assert.deepEqual(configSecretRefs(parsed.config), ['CRM_CLIENT_SECRET'])

  // A raw client secret in the note is the thing this exists to prevent.
  for (const auth of [
    { token_url: 'https://l.example.com/t', client_id: 'x', client_secret: 'raw-secret-value' },
    { token_url: 'https://l.example.com/t', client_id: 'x' }, // no secret at all
    { token_url: 'https://{{secret:HOST}}/t', client_id: 'x', client_secret: '{{secret:S}}' },
    { client_id: 'x', client_secret: '{{secret:S}}' }, // no token_url
  ]) {
    assert.ok(!parseConnectorConfig({ alias: 'http', base_url: 'https://x.com', auth }).ok)
  }

  // No auth block at all stays valid, with oauth null.
  const plain = parseConnectorConfig({ alias: 'http', base_url: 'https://x.com' })
  assert.ok(plain.ok)
  if (plain.ok && plain.config.alias === 'http') assert.equal(plain.config.oauth, null)
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

test('newConnectorNote emits a v2 note that parses back, secret and hosts included', () => {
  const note = newConnectorNote({
    name: 'stripe',
    description: 'Billing',
    hosts: ['API.Stripe.com', ''],
    secretName: 'stripe_key',
  })
  const parsed = parseConnectorPerimeter(parseFrontmatter(note))
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  assert.equal(parsed.legacy, null)
  assert.deepEqual(parsed.perimeter.hosts, ['api.stripe.com'])
  assert.equal(parsed.perimeter.env.STRIPE_KEY, '{{secret:STRIPE_KEY}}')
  assert.deepEqual(perimeterSecretRefs(parsed.perimeter), ['STRIPE_KEY'])
  // The value never appears — only the reference.
  assert.ok(!note.includes('sk_'))
  assert.ok(note.includes('env.STRIPE_KEY'))
})

test('newConnectorNote without hosts or secret is a valid no-network connector', () => {
  const note = newConnectorNote({ name: 'scratch' })
  const parsed = parseConnectorPerimeter(parseFrontmatter(note))
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  assert.deepEqual(parsed.perimeter.hosts, [])
  assert.deepEqual(parsed.perimeter.env, {})
})

/** Parse a list of rule strings, asserting each is well-formed. */
function rules(raw: string[]): AllowRule[] {
  return raw.map((r) => {
    const rule = parseAllowRule(r)
    assert.ok(rule, `bad test rule: ${r}`)
    return rule
  })
}

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

test('the MySQL guard speaks its own dialect', () => {
  for (const sql of [
    'select 1',
    'select `weird;name` from t', // backtick identifier with ; inside
    "select 'it''s' as escaped",
    "select 'back\\'slash' as escaped", // backslash escape, MySQL-specific
    'select 1 # hash comment with ; in it',
    'select 1 -- comment',
    'with t as (select 1) select * from t',
    'explain select * from users',
    'show tables',
    'describe users',
  ]) {
    assert.doesNotThrow(() => assertSingleReadOnlyMysqlStatement(sql), `should accept: ${sql}`)
  }
  for (const sql of [
    'select 1; drop table users',
    'insert into users values (1)',
    'update users set a = 1',
    'delete from users',
    'truncate users',
    'create table x (id int)',
    '',
  ]) {
    assert.throws(() => assertSingleReadOnlyMysqlStatement(sql), `should reject: ${sql}`)
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

// Connectors v2 — perimeter parsing and the legacy shim

test('v2 frontmatter parses into a perimeter', () => {
  const fm = parseFrontmatter(`---
type: connector
alias: http
hosts:
  - API.Stripe.com.
  - db.internal:5432
allow:
  - "GET /v1/customers*"
env:
  STRIPE_KEY: "{{secret:STRIPE_KEY}}"
  MODE: live
timeout_ms: 45000
---`)
  const parsed = parseConnectorPerimeter(fm)
  assert.ok(parsed.ok)
  assert.equal(parsed.legacy, null)
  assert.deepEqual(parsed.perimeter.hosts, ['api.stripe.com', 'db.internal:5432'])
  assert.deepEqual(parsed.perimeter.allow, [{ method: 'GET', path: '/v1/customers', prefix: true }])
  assert.equal(parsed.perimeter.env.STRIPE_KEY, '{{secret:STRIPE_KEY}}')
  assert.equal(parsed.perimeter.env.MODE, 'live')
  assert.equal(parsed.perimeter.timeoutMs, 45_000)
  assert.deepEqual(perimeterSecretRefs(parsed.perimeter), ['STRIPE_KEY'])
})

test('v2 hosts validation refuses schemes, refs and junk; env validates names', () => {
  const bad = (fm: Record<string, unknown>, re: RegExp) => {
    const parsed = parseConnectorPerimeter(fm)
    assert.ok(!parsed.ok, JSON.stringify(fm))
    assert.match(parsed.error, re)
  }
  bad({ type: 'connector', hosts: ['https://api.stripe.com'] }, /Bad hosts entry/)
  bad({ type: 'connector', hosts: ['api.stripe.com/v1'] }, /Bad hosts entry/)
  bad({ type: 'connector', hosts: ['{{secret:HOST}}'] }, /Bad hosts entry/)
  bad({ type: 'connector', hosts: 'api.stripe.com' }, /must be a list/)
  bad({ type: 'connector', hosts: [], env: { '2BAD': 'x' } }, /Bad env variable name/)
  bad({ type: 'connector', hosts: [], env: { KEY: '{{secret:lower}}' } }, /Invalid secret name/)

  bad({ type: 'connector', hosts: [], env: { BIG: 'x'.repeat(70_000) } }, /too large/)

  // There is no reserved-name list any more: the proxy variables it protected
  // don't exist under the isolate, and `env` is a namespace so nothing shadows.
  const proxyVar = parseConnectorPerimeter({ type: 'connector', hosts: [], env: { HTTPS_PROXY: 'x' } })
  assert.ok(proxyVar.ok)
  assert.equal(proxyVar.perimeter.env.HTTPS_PROXY, 'x')

  const empty = parseConnectorPerimeter({ type: 'connector', hosts: [] })
  assert.ok(empty.ok)
  assert.deepEqual(empty.perimeter.hosts, [])
})

test('legacy http notes map onto perimeters: hosts from base_url + token_url, env from refs', () => {
  const fm = parseFrontmatter(`---
type: connector
alias: http
base_url: https://api.example.com/v2
headers:
  Authorization: "Bearer {{secret:EX_KEY}}"
auth:
  token_url: https://id.example.com/token
  client_id: my-app
  client_secret: "{{secret:EX_CLIENT_SECRET}}"
allow:
  - "GET /v1/things"
timeout_ms: 3000
---`)
  const parsed = parseConnectorPerimeter(fm)
  assert.ok(parsed.ok)
  assert.equal(parsed.legacy, 'http')
  assert.deepEqual(parsed.perimeter.hosts, ['api.example.com', 'id.example.com'])
  // The base_url path prefix folds into each rule — the proxy matches full paths.
  assert.deepEqual(parsed.perimeter.allow, [{ method: 'GET', path: '/v2/v1/things', prefix: false }])
  assert.equal(parsed.perimeter.env.EX_KEY, '{{secret:EX_KEY}}')
  assert.equal(parsed.perimeter.env.EX_CLIENT_SECRET, '{{secret:EX_CLIENT_SECRET}}')
  // v1 allowed 3s; the sandbox floor is 1s so the value survives.
  assert.equal(parsed.perimeter.timeoutMs, 3000)
})

test('legacy sql notes map with empty hosts and say why; mcp notes carry the endpoint host', () => {
  const sql = parseConnectorPerimeter(
    parseFrontmatter(`---
type: connector
alias: postgres
dsn: "{{secret:ANALYTICS_DSN}}"
---`),
  )
  assert.ok(sql.ok)
  assert.equal(sql.legacy, 'postgres')
  assert.deepEqual(sql.perimeter.hosts, [])
  assert.equal(sql.perimeter.env.ANALYTICS_DSN, '{{secret:ANALYTICS_DSN}}')
  assert.match(sql.warnings[0] ?? '', /hosts/)

  const mcp = parseConnectorPerimeter(
    parseFrontmatter(`---
type: connector
alias: mcp
url: https://mcp.linear.app/mcp
headers:
  Authorization: "Bearer {{secret:LINEAR_TOKEN}}"
allow:
  - list_issues
---`),
  )
  assert.ok(mcp.ok)
  assert.equal(mcp.legacy, 'mcp')
  assert.deepEqual(mcp.perimeter.hosts, ['mcp.linear.app'])
  assert.equal(mcp.perimeter.env.LINEAR_TOKEN, '{{secret:LINEAR_TOKEN}}')
  assert.match(mcp.warnings[0] ?? '', /tool/)
})

test('a note that is neither v2 nor a valid legacy config reads as a hosts problem', () => {
  const parsed = parseConnectorPerimeter({ type: 'connector', description: 'just words' })
  assert.ok(!parsed.ok)
  assert.match(parsed.error, /needs `hosts:`/)
})

// ── model connectors (kind: model) ──

test('a model connector parses to its registry provider and never a perimeter', () => {
  const fm = parseFrontmatter(`---
type: connector
kind: model
provider: OpenAI
description: our account
---`)
  assert.equal(connectorKind(fm), 'model')
  const parsed = parseModelConnector(fm)
  assert.ok(parsed.ok)
  assert.equal(parsed.config.provider.id, 'openai')
  const info = modelConnectorInfo(parsed.config)
  assert.equal(info.keySecret, 'MODEL_KEY_OPENAI')
  assert.equal(info.baseURL, 'https://api.openai.com/v1/')
  assert.ok(info.models.some((m) => m.id === 'gpt-4.1'))
  // No `kind:` (or any other kind) is an ordinary perimeter connector.
  assert.equal(connectorKind({ type: 'connector', hosts: [] }), 'http')
  assert.equal(connectorKind({ type: 'connector', kind: 'http' }), 'http')
})

test('a model connector refuses unknown providers and any perimeter field', () => {
  const noProvider = parseModelConnector({ type: 'connector', kind: 'model' })
  assert.ok(!noProvider.ok)
  assert.match(noProvider.error, /provider:/)

  const unknown = parseModelConnector({ type: 'connector', kind: 'model', provider: 'mistral' })
  assert.ok(!unknown.ok)
  assert.match(unknown.error, /unknown model provider "mistral"/)

  // A model connector binding MODEL_KEY_* into an isolate env would let any
  // member with connectors:use read the key — hosts/env/allow are refused.
  for (const key of ['hosts', 'env', 'allow', 'base_url']) {
    const withPerimeter = parseModelConnector({ type: 'connector', kind: 'model', provider: 'gemini', [key]: [] })
    assert.ok(!withPerimeter.ok, key)
    assert.match(withPerimeter.error, new RegExp(`\`${key}:\``))
  }
})

test('newModelConnectorNote round-trips through parseModelConnector', () => {
  const note = newModelConnectorNote({ name: 'anthropic', provider: 'anthropic', description: 'Claude, billed to ops' })
  const fm = parseFrontmatter(note)
  assert.equal(fm.type, 'connector')
  assert.equal(fm.kind, 'model')
  assert.equal(fm.alias, 'model')
  assert.equal(fm.description, 'Claude, billed to ops')
  const parsed = parseModelConnector(fm)
  assert.ok(parsed.ok)
  assert.equal(parsed.config.provider.id, 'anthropic')
  assert.match(note, /MODEL_KEY_ANTHROPIC/)
  assert.match(note, /model: anthropic\/claude-opus-5/)
  assert.doesNotMatch(note, /hosts:/)

  const custom = newModelConnectorNote({ name: 'ollama', provider: 'custom' })
  assert.match(custom, /custom endpoint/)
  assert.match(custom, /model: custom\/<model-id>/)
  assert.throws(() => newModelConnectorNote({ name: 'x', provider: 'nope' }), /unknown model provider/)
})
