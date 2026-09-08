// The egress policy: what an agent's machine may reach. The tests that matter
// here are the refusals — every one of them is a way out that the grammar or
// the evaluation order closes.
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/vm-policy.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PLATFORM_DENY,
  PolicyError,
  canonical,
  compile,
  evaluate,
  hostMatches,
  isAddressLiteral,
  type VmPolicy,
} from '@visvine/vm-policy'
import { machineHostPatterns } from '@/lib/vm/shared/hosts'

const SPACE = ['api.github.com', '*.slack.com', 'registry.npmjs.org']

function policyFor(over: Partial<Parameters<typeof compile>[0]> = {}): VmPolicy {
  return compile({ spaceAllow: SPACE, ...over }).policy
}

function verdict(policy: VmPolicy, url: string, method = 'GET') {
  return evaluate(policy, { method, url })
}

test('an allowed host is allowed', () => {
  const d = verdict(policyFor(), 'https://api.github.com/user/repos')
  assert.equal(d.verdict, 'allow')
})

test('a wildcard matches subdomains at any depth and never the apex', () => {
  const policy = policyFor()
  assert.equal(verdict(policy, 'https://files.slack.com/x').verdict, 'allow')
  assert.equal(verdict(policy, 'https://a.b.slack.com/x').verdict, 'allow')
  assert.equal(verdict(policy, 'https://slack.com/x').verdict, 'deny')
})

test('a host nobody listed is denied', () => {
  const d = verdict(policyFor(), 'https://evil.example.com/collect')
  assert.equal(d.verdict, 'deny')
  assert.match(d.verdict === 'deny' ? d.reason : '', /not in this agent's allowed hosts/)
})

// The single most dangerous default in the stack, inverted here on purpose:
// the substrate reads an empty allow list as "allow everything".
test('an empty allow list denies rather than opening', () => {
  const policy = compile({ spaceAllow: [], taskAllow: [] }).policy
  assert.equal(policy.allow.length, 0)
  const d = verdict(policy, 'https://api.github.com/user')
  assert.equal(d.verdict, 'deny')
  assert.match(d.verdict === 'deny' ? d.reason : '', /allows nothing/)
})

test('an address literal is denied before any list is read', () => {
  const wide = compile({ spaceAllow: ['*.example.com'] }).policy
  for (const url of [
    'https://140.82.121.4/',
    'https://[2606:4700::1111]/',
    'https://192.168.1.1/',
    'https://169.254.169.254/latest/meta-data/',
  ]) {
    const d = verdict(wide, url)
    assert.equal(d.verdict, 'deny', url)
    assert.match(d.verdict === 'deny' ? d.reason : '', /hostnames, not addresses/)
  }
})

test('plain http is denied', () => {
  const d = verdict(policyFor(), 'http://api.github.com/user')
  assert.equal(d.verdict, 'deny')
  assert.match(d.verdict === 'deny' ? d.reason : '', /agents speak https/)
})

test('the platform denylist is not overridable by configuration', () => {
  // Even asked for explicitly, and even reachable under a wildcard the space granted.
  const policy = compile({ spaceAllow: ['*.internal', 'metadata.google.internal'] }).policy
  assert.equal(verdict(policy, 'https://metadata.google.internal/computeMetadata/v1/').verdict, 'deny')
  assert.equal(verdict(policy, 'https://db.internal/').verdict, 'deny')
  for (const entry of PLATFORM_DENY) assert.ok(policy.deny.includes(entry))
})

test('a task may narrow and may never widen', () => {
  const { policy, dropped } = compile({ spaceAllow: SPACE, taskAllow: ['api.github.com', 'evil.example.com'] })
  assert.deepEqual([...policy.allow], ['api.github.com'])
  assert.deepEqual([...dropped], ['evil.example.com'])
  assert.equal(verdict(policy, 'https://registry.npmjs.org/x').verdict, 'deny')
})

test('a task may narrow inside a wildcard the space granted', () => {
  const { policy, dropped } = compile({ spaceAllow: ['*.slack.com'], taskAllow: ['files.slack.com'] })
  assert.deepEqual([...policy.allow], ['files.slack.com'])
  assert.equal(dropped.length, 0)
})

test('a task may not turn an exact host into a wildcard over it', () => {
  const { policy, dropped } = compile({ spaceAllow: ['api.github.com'], taskAllow: ['*.github.com'] })
  assert.equal(policy.allow.length, 0)
  assert.deepEqual([...dropped], ['*.github.com'])
})

test('an approval host is held rather than allowed or denied', () => {
  const policy = compile({ spaceAllow: ['api.stripe.com'], approval: ['api.stripe.com'] }).policy
  const d = verdict(policy, 'https://api.stripe.com/v1/charges', 'POST')
  assert.equal(d.verdict, 'approval')
})

test('an injection names a binding, applies only to its host, and never leaves the edge', () => {
  const policy = compile({
    spaceAllow: SPACE,
    inject: [{ host: 'api.github.com', header: 'Authorization', secret: 'GITHUB_TOKEN' }],
  }).policy
  const allowed = verdict(policy, 'https://api.github.com/user')
  assert.equal(allowed.verdict, 'allow')
  assert.deepEqual(allowed.verdict === 'allow' ? [...allowed.inject] : [], [
    { header: 'Authorization', secret: 'GITHUB_TOKEN' },
  ])

  // The same credential must not ride along to a different allowed host.
  const other = verdict(policy, 'https://registry.npmjs.org/left-pad')
  assert.equal(other.verdict === 'allow' && other.inject.length, 0)

  // And the policy itself carries a binding name, never a value.
  assert.ok(!canonical(policy).includes('ghp_'))
})

test('an injection into a host the policy does not allow is a compile error', () => {
  assert.throws(
    () => compile({ spaceAllow: ['api.github.com'], inject: [{ host: 'evil.example.com', header: 'Authorization', secret: 'TOKEN' }] }),
    PolicyError,
  )
})

test('the grammar refuses what it cannot enforce', () => {
  for (const bad of [
    '10.0.0.0/8',            // a CIDR range bypasses hostname rules entirely
    '203.0.113.10',          // an address literal
    'api*.example.com',      // a partial-label wildcard
    'https://example.com',   // a URL
    'example.com:443',       // a port
    'example.com/path',      // a path
    'localhost',             // no domain
    '',
  ]) {
    assert.throws(() => compile({ spaceAllow: [bad] }), PolicyError, bad)
  }
})

test('a policy the edge cannot read denies', () => {
  const d = evaluate({ version: 2 } as unknown as VmPolicy, { method: 'GET', url: 'https://api.github.com/' })
  assert.equal(d.verdict, 'deny')
})

test('host matching is case- and trailing-dot-insensitive', () => {
  assert.ok(hostMatches('API.GitHub.com', 'api.github.com.'))
  assert.ok(hostMatches('*.slack.com', 'FILES.slack.com'))
})

test('address detection covers the shapes a resolver would accept', () => {
  for (const h of ['127.0.0.1', '::1', '[::1]', '2606:4700::1111', 'example.123']) {
    assert.ok(isAddressLiteral(h), h)
  }
  for (const h of ['api.github.com', 'x1.example.com']) assert.ok(!isAddressLiteral(h), h)
})

test('the canonical form is stable regardless of input order', () => {
  const a = compile({ spaceAllow: ['b.example.com', 'a.example.com'] }).policy
  const b = compile({ spaceAllow: ['a.example.com', 'b.example.com'] }).policy
  assert.equal(canonical(a), canonical(b))
})

test("a connector's hosts: become machine patterns — port dropped, the unenforceable rejected, never thrown", () => {
  const { patterns, rejected } = machineHostPatterns([
    'db.example.com:5432',
    'API.Example.com',
    '10.0.0.4',
    'localhost',
    '*.slack.com',
    '',
    'api.example.com',
  ])
  assert.deepEqual(patterns, ['*.slack.com', 'api.example.com', 'db.example.com'])
  assert.deepEqual(rejected, ['10.0.0.4', 'localhost'])
})
