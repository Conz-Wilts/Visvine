// The `webhook:` block: parsing, and every signature scheme against vectors
// computed independently here (node:crypto) — the presets must match what the
// providers actually send.
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/connector-webhook.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  extractEventField,
  parseConnectorWebhook,
  pickWebhookHeaders,
  verifyWebhookSignature,
  webhookDedupeKey,
  webhookSummary,
  webhookTokenSecretName,
  type ConnectorWebhook,
} from '@/lib/connectors/webhook'
import { parseConnectorPerimeter, perimeterSecretRefs } from '@/lib/connectors/config'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'

const SECRET = 'whsec_test_0123456789'
const BODY = Buffer.from('{"event":"contact.created","id":"evt_1","event_type":{"kind":"x"}}')

function parsed(raw: unknown): ConnectorWebhook {
  const r = parseConnectorWebhook(raw)
  assert.ok(r.ok, r.ok ? '' : r.error)
  assert.ok(r.webhook)
  return r.webhook
}

const headersOf = (map: Record<string, string>) => (name: string) => map[name.toLowerCase()] ?? null

// ── Parsing ─────────────────────────────────────────────────────────────────

test('absent / false → no webhook; true → an unsigned address', () => {
  assert.deepEqual(parseConnectorWebhook(undefined), { ok: true, webhook: null })
  assert.deepEqual(parseConnectorWebhook(false), { ok: true, webhook: null })
  const w = parsed(true)
  assert.equal(w.signature, 'none')
  assert.equal(w.header, null)
  assert.equal(w.secretName, null)
  assert.equal(w.maxBytes, 262_144)
})

test('the full HubSpot-style block parses with the documented fields', () => {
  const w = parsed({
    signature: 'hmac-sha256',
    secret: '{{secret:HUBSPOT_WEBHOOK_SECRET}}',
    header: 'X-HubSpot-Signature-V3',
    prefix: 'sha256=',
    encoding: 'base64',
    id_header: 'X-Delivery-Id',
    event_field: '$.event',
    max_bytes: 4096,
  })
  assert.equal(w.signature, 'hmac-sha256')
  assert.equal(w.secretName, 'HUBSPOT_WEBHOOK_SECRET')
  assert.equal(w.header, 'x-hubspot-signature-v3')
  assert.equal(w.prefix, 'sha256=')
  assert.equal(w.encoding, 'base64')
  assert.equal(w.idHeader, 'x-delivery-id')
  assert.equal(w.eventField, 'event')
  assert.equal(w.maxBytes, 4096)
})

test('presets fill header / prefix / encoding / id header', () => {
  const gh = parsed({ signature: 'github', secret: '{{secret:GH}}' })
  assert.equal(gh.header, 'x-hub-signature-256')
  assert.equal(gh.prefix, 'sha256=')
  assert.equal(gh.idHeader, 'x-github-delivery')
  const stripe = parsed({ signature: 'stripe', secret: '{{secret:STRIPE_WH}}' })
  assert.equal(stripe.header, 'stripe-signature')
  assert.equal(stripe.eventField, 'type')
  const slack = parsed({ signature: 'slack', secret: '{{secret:SLACK}}' })
  assert.equal(slack.header, 'x-slack-signature')
  assert.equal(slack.prefix, 'v0=')
  const hs = parsed({ signature: 'hubspot', secret: '{{secret:HS}}' })
  assert.equal(hs.header, 'x-hubspot-signature-v3')
  assert.equal(hs.encoding, 'base64')
})

test('refusals: unknown scheme, missing secret, secret with none, bad ref, missing header, size', () => {
  const err = (raw: unknown) => {
    const r = parseConnectorWebhook(raw)
    assert.ok(!r.ok)
    return r.error
  }
  assert.match(err({ signature: 'md5' }), /signature/)
  assert.match(err({ signature: 'github' }), /secret.*required/)
  assert.match(err({ signature: 'none', secret: '{{secret:X}}' }), /no effect/)
  assert.match(err({ signature: 'github', secret: 'literal-value' }), /secret reference/)
  assert.match(err({ signature: 'hmac-sha256', secret: '{{secret:X}}' }), /header.*required/)
  assert.match(err({ signature: 'token', secret: '{{secret:X}}' }), /header.*required/)
  assert.match(err({ signature: 'github', secret: '{{secret:X}}', max_bytes: 10 }), /max_bytes/)
  assert.match(err({ signature: 'github', secret: '{{secret:X}}', max_bytes: 5_000_000 }), /max_bytes/)
  assert.match(err({ signature: 'github', secret: '{{secret:X}}', event_field: 'a b' }), /event_field/)
  assert.match(err(['github']), /mapping/)
})

test('the block rides parseConnectorPerimeter and stays OUT of perimeterSecretRefs', () => {
  const fm = parseFrontmatter(
    [
      '---',
      'type: connector',
      'hosts: [api.github.com]',
      'env:',
      '  TOKEN: "{{secret:GH_TOKEN}}"',
      'webhook:',
      '  signature: github',
      '  secret: "{{secret:GH_WEBHOOK_SECRET}}"',
      '---',
      'docs',
    ].join('\n'),
  )
  const r = parseConnectorPerimeter(fm)
  assert.ok(r.ok)
  assert.equal(r.perimeter.webhook?.signature, 'github')
  assert.equal(r.perimeter.webhook?.secretName, 'GH_WEBHOOK_SECRET')
  assert.deepEqual(perimeterSecretRefs(r.perimeter), ['GH_TOKEN'])

  const bad = parseConnectorPerimeter(parseFrontmatter('---\ntype: connector\nhosts: []\nwebhook:\n  signature: nope\n---\n'))
  assert.ok(!bad.ok)
  assert.match(bad.error, /webhook.signature/)
})

// ── Verification ────────────────────────────────────────────────────────────

test('none accepts anything; a missing secret refuses every other scheme', () => {
  assert.deepEqual(verifyWebhookSignature(parsed(true), { header: () => null, body: BODY, secret: null }), { ok: true })
  const gh = parsed({ signature: 'github', secret: '{{secret:X}}' })
  const r = verifyWebhookSignature(gh, { header: () => 'sha256=abc', body: BODY, secret: null })
  assert.ok(!r.ok && /secret not set/.test(r.reason))
})

test('token: constant-time compare against the header value', () => {
  const w = parsed({ signature: 'token', secret: '{{secret:X}}', header: 'x-webhook-token' })
  assert.ok(verifyWebhookSignature(w, { header: headersOf({ 'x-webhook-token': SECRET }), body: BODY, secret: SECRET }).ok)
  assert.ok(!verifyWebhookSignature(w, { header: headersOf({ 'x-webhook-token': SECRET + 'x' }), body: BODY, secret: SECRET }).ok)
  assert.ok(!verifyWebhookSignature(w, { header: () => null, body: BODY, secret: SECRET }).ok)
})

test('github: sha256=<hex> over the raw body', () => {
  const w = parsed({ signature: 'github', secret: '{{secret:X}}' })
  const hex = createHmac('sha256', SECRET).update(BODY).digest('hex')
  const ok = verifyWebhookSignature(w, { header: headersOf({ 'x-hub-signature-256': `sha256=${hex}` }), body: BODY, secret: SECRET })
  assert.deepEqual(ok, { ok: true })
  // Upper-case hex is the same digest.
  assert.ok(verifyWebhookSignature(w, { header: headersOf({ 'x-hub-signature-256': `sha256=${hex.toUpperCase()}` }), body: BODY, secret: SECRET }).ok)
  // Wrong prefix, wrong body, wrong secret.
  assert.ok(!verifyWebhookSignature(w, { header: headersOf({ 'x-hub-signature-256': `sha1=${hex}` }), body: BODY, secret: SECRET }).ok)
  assert.ok(!verifyWebhookSignature(w, { header: headersOf({ 'x-hub-signature-256': `sha256=${hex}` }), body: Buffer.from('{}'), secret: SECRET }).ok)
  assert.ok(!verifyWebhookSignature(w, { header: headersOf({ 'x-hub-signature-256': `sha256=${hex}` }), body: BODY, secret: 'other' }).ok)
})

test('hmac-sha1 with a custom header and prefix (legacy GitHub)', () => {
  const w = parsed({ signature: 'hmac-sha1', secret: '{{secret:X}}', header: 'X-Hub-Signature', prefix: 'sha1=' })
  const hex = createHmac('sha1', SECRET).update(BODY).digest('hex')
  assert.ok(verifyWebhookSignature(w, { header: headersOf({ 'x-hub-signature': `sha1=${hex}` }), body: BODY, secret: SECRET }).ok)
  assert.ok(!verifyWebhookSignature(w, { header: headersOf({ 'x-hub-signature': hex }), body: BODY, secret: SECRET }).ok)
})

test('generic hmac-sha256: hex and base64 encodings', () => {
  const hex = createHmac('sha256', SECRET).update(BODY).digest('hex')
  const b64 = createHmac('sha256', SECRET).update(BODY).digest('base64')
  const wHex = parsed({ signature: 'hmac-sha256', secret: '{{secret:X}}', header: 'x-sig' })
  assert.ok(verifyWebhookSignature(wHex, { header: headersOf({ 'x-sig': hex }), body: BODY, secret: SECRET }).ok)
  assert.ok(!verifyWebhookSignature(wHex, { header: headersOf({ 'x-sig': b64 }), body: BODY, secret: SECRET }).ok)
  const wB64 = parsed({ signature: 'hmac-sha256', secret: '{{secret:X}}', header: 'x-sig', encoding: 'base64' })
  assert.ok(verifyWebhookSignature(wB64, { header: headersOf({ 'x-sig': b64 }), body: BODY, secret: SECRET }).ok)
  assert.ok(!verifyWebhookSignature(wB64, { header: headersOf({ 'x-sig': hex }), body: BODY, secret: SECRET }).ok)
})

test('stripe: t=/v1= over "<t>.<body>", 5-minute tolerance, several v1 during a roll', () => {
  const w = parsed({ signature: 'stripe', secret: '{{secret:X}}' })
  const now = 1_700_000_000
  const sign = (t: number, secret = SECRET) =>
    createHmac('sha256', secret).update(`${t}.`).update(BODY).digest('hex')
  const good = { header: headersOf({ 'stripe-signature': `t=${now},v1=${sign(now)}` }), body: BODY, secret: SECRET, nowSeconds: now + 60 }
  assert.deepEqual(verifyWebhookSignature(w, good), { ok: true })
  // Rolled: old v1 first, new one second — either matches.
  const rolled = { ...good, header: headersOf({ 'stripe-signature': `t=${now},v1=${sign(now, 'old')},v1=${sign(now)},v0=zzz` }) }
  assert.ok(verifyWebhookSignature(w, rolled).ok)
  // Too old.
  const stale = { ...good, nowSeconds: now + 301 }
  const r = verifyWebhookSignature(w, stale)
  assert.ok(!r.ok && /tolerance/.test(r.reason))
  // Tampered timestamp: signature no longer matches.
  const tampered = { ...good, header: headersOf({ 'stripe-signature': `t=${now + 5},v1=${sign(now)}` }) }
  assert.ok(!verifyWebhookSignature(w, tampered).ok)
  // Malformed.
  assert.ok(!verifyWebhookSignature(w, { ...good, header: headersOf({ 'stripe-signature': 'nonsense' }) }).ok)
})

test('slack: v0=<hex> over "v0:<ts>:<body>", timestamp header, tolerance', () => {
  const w = parsed({ signature: 'slack', secret: '{{secret:X}}' })
  const now = 1_700_000_000
  const sig = 'v0=' + createHmac('sha256', SECRET).update(`v0:${now}:`).update(BODY).digest('hex')
  const ok = verifyWebhookSignature(w, {
    header: headersOf({ 'x-slack-signature': sig, 'x-slack-request-timestamp': String(now) }),
    body: BODY,
    secret: SECRET,
    nowSeconds: now + 10,
  })
  assert.deepEqual(ok, { ok: true })
  const late = verifyWebhookSignature(w, {
    header: headersOf({ 'x-slack-signature': sig, 'x-slack-request-timestamp': String(now) }),
    body: BODY,
    secret: SECRET,
    nowSeconds: now + 600,
  })
  assert.ok(!late.ok)
  const noTs = verifyWebhookSignature(w, { header: headersOf({ 'x-slack-signature': sig }), body: BODY, secret: SECRET, nowSeconds: now })
  assert.ok(!noTs.ok)
})

test('hubspot v3: base64 HMAC over method + url + body + timestamp (ms)', () => {
  const w = parsed({ signature: 'hubspot', secret: '{{secret:X}}' })
  const url = 'https://visvine.example/api/hooks/s1/hubspot/' + 'a'.repeat(64)
  const nowMs = 1_700_000_000_000
  const sig = createHmac('sha256', SECRET).update('POST').update(url).update(BODY).update(String(nowMs)).digest('base64')
  const headers = headersOf({ 'x-hubspot-signature-v3': sig, 'x-hubspot-request-timestamp': String(nowMs) })
  assert.deepEqual(
    verifyWebhookSignature(w, { header: headers, body: BODY, secret: SECRET, url, method: 'POST', nowSeconds: nowMs / 1000 + 30 }),
    { ok: true },
  )
  // A different URL (a replay onto another hook) fails.
  assert.ok(!verifyWebhookSignature(w, { header: headers, body: BODY, secret: SECRET, url: url + 'x', method: 'POST', nowSeconds: nowMs / 1000 }).ok)
  // Stale.
  assert.ok(!verifyWebhookSignature(w, { header: headers, body: BODY, secret: SECRET, url, method: 'POST', nowSeconds: nowMs / 1000 + 400 }).ok)
})

// ── Helpers ─────────────────────────────────────────────────────────────────

test('token secret name, dedupe key, event field, summary, header allowlist', () => {
  assert.match(webhookTokenSecretName('hub-spot.v2'), /^WEBHOOK_TOKEN_HUB_SPOT_V2_[A-F0-9]{8}$/)
  // Names that normalise alike must NOT share a token.
  assert.notEqual(webhookTokenSecretName('foo-bar'), webhookTokenSecretName('foo_bar'))
  // And a maximal name still fits the secret-name grammar.
  assert.match(webhookTokenSecretName('a'.repeat(64)), /^[A-Z][A-Z0-9_]{0,63}$/)

  const gh = parsed({ signature: 'github', secret: '{{secret:X}}' })
  assert.equal(webhookDedupeKey(gh, headersOf({ 'x-github-delivery': 'd-1' }), BODY, 'gh'), 'webhook:gh:id:d-1')
  const byBody = webhookDedupeKey(gh, () => null, BODY, 'gh')
  assert.match(byBody, /^webhook:gh:sha256:[a-f0-9]{64}$/)
  assert.equal(byBody, webhookDedupeKey(gh, () => null, Buffer.from(BODY), 'gh'))
  // Scoped per connector: the same delivery id from two hooks is two events.
  assert.notEqual(byBody, webhookDedupeKey(gh, () => null, BODY, 'other'))

  const json = JSON.parse(BODY.toString())
  assert.equal(extractEventField(json, 'event'), 'contact.created')
  assert.equal(extractEventField(json, 'event_type.kind'), 'x')
  assert.equal(extractEventField(json, 'event_type'), null)
  assert.equal(extractEventField(json, 'missing.deep'), null)
  assert.equal(extractEventField('text body', 'event'), null)
  assert.equal(extractEventField(null, null), null)

  assert.equal(webhookSummary('hubspot', 'contact.created', 'POST', 'd-1'), 'hubspot contact.created (d-1)')
  assert.equal(webhookSummary('hubspot', null, 'post', null), 'hubspot POST')

  const picked = pickWebhookHeaders(gh, headersOf({
    'content-type': 'application/json',
    'x-github-event': 'push',
    'x-github-delivery': 'd-1',
    'x-hub-signature-256': 'sha256=deadbeef',
    authorization: 'Bearer nope',
  }))
  assert.deepEqual(picked, { 'content-type': 'application/json', 'x-github-event': 'push', 'x-github-delivery': 'd-1' })
})
