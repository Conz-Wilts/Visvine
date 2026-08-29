// The outbound handler: what happens to a request once the policy has judged
// it. The policy's own decisions are tested in apps/web/tests/vm-policy.test.ts;
// these are about what the edge DOES with them — above all, that a credential
// reaches exactly one host and nothing else.
// Run: pnpm --filter @visvine/agent-edge test
import test from 'node:test'
import assert from 'node:assert/strict'
import { compile } from '@visvine/vm-policy'
import { handleOutbound, type EgressRecord } from '../src/outbound'

const POLICY = compile({
  spaceAllow: ['api.github.com', 'registry.npmjs.org', 'api.stripe.com'],
  approval: ['api.stripe.com'],
  inject: [{ host: 'api.github.com', header: 'Authorization', secret: 'GITHUB_TOKEN' }],
}).policy

const SECRETS = { GITHUB_TOKEN: 'Bearer ghp_notreal' }

function harness(overrides: { policy?: typeof POLICY | null; secrets?: Record<string, string | undefined> } = {}) {
  const records: EgressRecord[] = []
  const seen: Request[] = []
  return {
    records,
    seen,
    ctx: {
      policy: overrides.policy === undefined ? POLICY : overrides.policy,
      secrets: overrides.secrets ?? SECRETS,
      record: (entry: EgressRecord) => records.push(entry),
      fetchUpstream: async (request: Request) => {
        seen.push(request)
        return new Response('ok', { status: 200, headers: { 'content-length': '2' } })
      },
    },
  }
}

test('an allowed request reaches upstream and is recorded', async () => {
  const h = harness()
  const res = await handleOutbound(new Request('https://registry.npmjs.org/left-pad'), h.ctx)
  assert.equal(res.status, 200)
  assert.equal(h.seen.length, 1)
  assert.equal(h.records[0]?.verdict, 'allow')
  assert.equal(h.records[0]?.host, 'registry.npmjs.org')
  assert.equal(h.records[0]?.status, 200)
})

test('a denied request never reaches the network', async () => {
  const h = harness()
  const res = await handleOutbound(new Request('https://evil.example.com/collect'), h.ctx)
  assert.equal(res.status, 403)
  assert.equal(h.seen.length, 0)
  assert.equal(h.records[0]?.verdict, 'deny')
  assert.match(await res.text(), /not in this agent's allowed hosts/)
})

test('the credential goes to its host and to no other', async () => {
  const h = harness()
  await handleOutbound(new Request('https://api.github.com/user'), h.ctx)
  assert.equal(h.seen[0]?.headers.get('Authorization'), 'Bearer ghp_notreal')

  await handleOutbound(new Request('https://registry.npmjs.org/left-pad'), h.ctx)
  assert.equal(h.seen[1]?.headers.get('Authorization'), null)
})

test('a header the machine set itself cannot pass for the injected one', async () => {
  const h = harness()
  await handleOutbound(
    new Request('https://api.github.com/user', { headers: { Authorization: 'Bearer attacker-supplied' } }),
    h.ctx,
  )
  assert.equal(h.seen[0]?.headers.get('Authorization'), 'Bearer ghp_notreal')
})

test('the record carries the host and never the credential', async () => {
  const h = harness()
  await handleOutbound(new Request('https://api.github.com/user'), h.ctx)
  assert.ok(!JSON.stringify(h.records).includes('ghp_notreal'))
})

test('a promised credential the edge does not hold refuses rather than sending an unauthenticated request', async () => {
  const h = harness({ secrets: {} })
  const res = await handleOutbound(new Request('https://api.github.com/user'), h.ctx)
  assert.equal(res.status, 503)
  assert.equal(h.seen.length, 0)
})

test('a machine with no policy reaches nothing', async () => {
  const h = harness({ policy: null })
  const res = await handleOutbound(new Request('https://api.github.com/user'), h.ctx)
  assert.equal(res.status, 403)
  assert.equal(h.seen.length, 0)
  assert.match(await res.text(), /no policy yet/)
})

test('an approval host is refused until an approval exists, and is recorded as such', async () => {
  const h = harness()
  const res = await handleOutbound(new Request('https://api.stripe.com/v1/charges', { method: 'POST' }), h.ctx)
  assert.equal(res.status, 403)
  assert.equal(h.seen.length, 0)
  assert.equal(h.records[0]?.verdict, 'approval')
})

test('the ways out that are not hostnames', async () => {
  const h = harness()
  for (const url of [
    'https://140.82.121.4/',            // the allowed host, by address
    'https://169.254.169.254/latest/',  // the metadata endpoint
    'http://api.github.com/user',       // plain HTTP
  ]) {
    const res = await handleOutbound(new Request(url), h.ctx)
    assert.equal(res.status, 403, url)
  }
  assert.equal(h.seen.length, 0)
})
