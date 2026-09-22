import test from 'node:test'
import assert from 'node:assert/strict'
import { isE164, maskPhone, normalizePhone } from '../lib/imessage/shared/phone'
import { readInbound, inboundPayloadSchema } from '../lib/imessage/shared/inbound'
import { codeInText, codeIsLive, linkCodeFrom } from '../lib/imessage/shared/link'
import { askWhich, namedCandidate, pickTarget, switchTo, type TargetCandidate } from '../lib/imessage/shared/targets'
import { plainText, replyText, REPLY_CAP } from '../lib/imessage/shared/reply'
import { replyAddressOf } from '../lib/imessage/reply'
import { ALL_FEATURE_KEYS, ADMIN_ONLY_FEATURE_KEYS, NAV_HIDDEN_FEATURE_KEYS, defaultFeatureConfig } from '../lib/featureAccess'
import type { ChannelKind } from '../lib/agents/shared/channels'

// ── phones ──────────────────────────────────────────────────────────────────

test('normalizePhone: E.164 in, E.164 out; national numbers take the default country', () => {
  assert.equal(normalizePhone('+64 21 555 0102'), '+64215550102')
  assert.equal(normalizePhone('(415) 555-0100'), '+14155550100')
  assert.equal(normalizePhone('021 555 0102', '64'), '+64215550102')
  assert.equal(normalizePhone('0064 21 555 0102'), '+64215550102')
  assert.equal(normalizePhone('hello'), null)
  assert.equal(normalizePhone('+0123'), null)
  assert.ok(isE164('+14155550100'))
  assert.equal(isE164('4155550100'), false)
})

test('maskPhone keeps the country and the tail', () => {
  assert.equal(maskPhone('+64215550102'), '+64 ••• •102')
})

// ── inbound ─────────────────────────────────────────────────────────────────

const base = { message_handle: 'h1', from_number: '+64215550102', sendblue_number: '+14155550199' }

test('readInbound: a received text is work; echoes, statuses and groups are not', () => {
  assert.deepEqual(readInbound({ ...base, content: 'hi', status: 'RECEIVED' }), {
    kind: 'text',
    message: { handle: 'h1', from: '+64215550102', line: '+14155550199', text: 'hi' },
  })
  assert.deepEqual(readInbound({ ...base, content: 'hi', is_outbound: true }), { kind: 'ignore', reason: 'outbound' })
  assert.deepEqual(readInbound({ ...base, content: 'hi', group_id: 'g' }), { kind: 'ignore', reason: 'group' })
  assert.deepEqual(readInbound({ ...base, content: 'hi', status: 'ERROR' }), { kind: 'ignore', reason: 'status' })
  assert.deepEqual(readInbound({ ...base, content: '', media_url: 'https://cdn/x.jpg' }), {
    kind: 'not_text',
    from: '+64215550102',
    line: '+14155550199',
    handle: 'h1',
  })
  assert.equal(readInbound({ ...base, from_number: 'nope', content: 'hi' }).kind, 'ignore')
})

test('inbound payload schema accepts the documented shape and refuses garbage', () => {
  assert.ok(inboundPayloadSchema.safeParse({ ...base, content: 'x', is_outbound: false, media_url: null }).success)
  assert.equal(inboundPayloadSchema.safeParse({ from_number: '+1' }).success, false)
})

// ── linking ─────────────────────────────────────────────────────────────────

test('link codes: six digits from bytes, found in a text, live until they expire', () => {
  const code = linkCodeFrom(new Uint8Array([10, 21, 32, 43, 54, 65, 76]))
  assert.match(code, /^\d{6}$/)
  assert.equal(codeInText(' 123 456 '), '123456')
  assert.equal(codeInText('code: 123456'), '123456')
  assert.equal(codeInText('call me on 021 555 0102'), null)
  assert.equal(codeInText('12345'), null)
  const now = new Date('2026-09-22T00:00:00Z')
  assert.ok(codeIsLive('123456', new Date('2026-09-22T00:05:00Z'), now))
  assert.equal(codeIsLive('123456', new Date('2026-09-21T23:59:00Z'), now), false)
  assert.equal(codeIsLive(null, new Date('2026-09-22T00:05:00Z'), now), false)
})

// ── targets ─────────────────────────────────────────────────────────────────

const acme: TargetCandidate = { spaceId: 'acme', name: 'Acme', house: true }
const design: TargetCandidate = { spaceId: 'acme:design', name: 'Design', house: false }
const eng: TargetCandidate = { spaceId: 'acme:eng', name: 'Engineering', house: false }

test('pickTarget: one candidate is the answer', () => {
  assert.deepEqual(pickTarget('anything', [design], null), { kind: 'target', spaceId: 'acme:design', switched: false })
  assert.deepEqual(pickTarget('anything', [], null), { kind: 'ask', candidates: [] })
})

test('pickTarget: a room named in the text wins; the bare name switches', () => {
  assert.deepEqual(pickTarget('add to Design: new logo review Friday', [acme, design, eng], 'acme'), {
    kind: 'target',
    spaceId: 'acme:design',
    switched: false,
  })
  assert.deepEqual(pickTarget('Design', [acme, design, eng], 'acme'), { kind: 'target', spaceId: 'acme:design', switched: true })
  assert.deepEqual(pickTarget('switch to engineering please', [acme, design, eng], null), {
    kind: 'target',
    spaceId: 'acme:eng',
    switched: true,
  })
  // "designer" is not "Design".
  assert.equal(namedCandidate('hire a designer', [acme, design]), null)
  assert.equal(switchTo('design a poster', [acme, design]), null)
})

test('pickTarget: the thread sticks; nothing decided asks', () => {
  assert.deepEqual(pickTarget('what did we decide?', [acme, design], 'acme:design'), { kind: 'target', spaceId: 'acme:design', switched: false })
  const undecided = pickTarget('what did we decide?', [acme, design], null)
  assert.equal(undecided.kind, 'undecided')
  assert.equal(pickTarget('what did we decide?', [acme, design], 'gone').kind, 'undecided')
  assert.equal(askWhich([acme, design, eng]), 'Acme, Design or Engineering?')
})

// ── replies ─────────────────────────────────────────────────────────────────

test('plainText flattens the markdown a model writes into a text bubble', () => {
  assert.equal(plainText('## Done\n\n**Added** to [Sam](people/sam/index.md) and [[Ana]].\n- one\n- two'), 'Done\n\nAdded to Sam and Ana.\n• one\n• two')
})

test('replyText: the summary, where it landed only when there was a choice, one line on failure', () => {
  const space = { name: 'Design', ambiguous: false }
  assert.equal(replyText({ status: 'succeeded', summary: 'Added to Sam’s note.', error: null, writes: ['people/sam/index.md'], space }), 'Added to Sam’s note.')
  assert.equal(
    replyText({ status: 'succeeded', summary: 'Added to Sam’s note.', error: null, writes: ['x.md'], space: { ...space, ambiguous: true } }),
    'Added to Sam’s note.\n\n— Saved in Design',
  )
  assert.equal(replyText({ status: 'succeeded', summary: 'Nothing about SSO.', error: null, writes: [], space: { ...space, ambiguous: true } }), 'Nothing about SSO.\n\n— In Design')
  assert.equal(replyText({ status: 'failed', summary: null, error: 'The model rejected the key.', writes: [], space }), "Couldn't do that. The model rejected the key.")
  assert.equal(replyText({ status: 'succeeded', summary: null, error: null, writes: [], space }), 'Nothing to report.')
  const long = replyText({ status: 'succeeded', summary: 'x'.repeat(REPLY_CAP + 500), error: null, writes: [], space })
  assert.equal(long.length, REPLY_CAP)
  assert.ok(long.endsWith('…'))
})

test('replyAddressOf reads only an imessage event with a line and a phone', () => {
  assert.deepEqual(replyAddressOf({ channel: 'imessage', imessage: { line: '+1', phone: '+2', spaceName: 'Acme', ambiguous: true } }), {
    line: '+1',
    phone: '+2',
    spaceName: 'Acme',
    ambiguous: true,
  })
  assert.equal(replyAddressOf({ channel: 'in_app', imessage: { line: '+1', phone: '+2' } }), null)
  assert.equal(replyAddressOf({ channel: 'imessage' }), null)
})

// ── the feature key and the channel ─────────────────────────────────────────

test('imessage is a toggleable, admin-only, nav-hidden feature that starts off', () => {
  assert.ok(ALL_FEATURE_KEYS.includes('imessage'))
  assert.ok(ADMIN_ONLY_FEATURE_KEYS.includes('imessage'))
  assert.ok(NAV_HIDDEN_FEATURE_KEYS.includes('imessage'))
  assert.equal(defaultFeatureConfig().enabled?.imessage, false)
})

test('imessage is a channel kind', () => {
  const kind: ChannelKind = 'imessage'
  assert.equal(kind, 'imessage')
})
