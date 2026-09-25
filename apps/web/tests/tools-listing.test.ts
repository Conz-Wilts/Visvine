/**
 * Going global, as rules: where a listing request stands, licenses, staged
 * reach, the first-use notice a Tool from outside the space asks, and the
 * reach sentences an installing admin reads with the slots left in. Pure.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-listing.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseManifestFacts, type ToolManifestFacts } from '@visvine/tool-protocol/manifest'
import { resolveReach } from '@visvine/tool-protocol/bindings'
import {
  actingReachOf,
  actsAsViewer,
  consentCovers,
  consentSentence,
  initialStage,
  isActingMethod,
  isStaged,
  listingRequestState,
  parseLicense,
  stagedInstallDenial,
  stagedRate,
  STAGED_CAP,
  STAGED_DAYS,
} from '@/lib/tools/shared/listing'
import { reachSentences } from '@/lib/tools/shared/reachWords'
import { toolActionActs } from '@/lib/tools/actionAllowlist'

function facts(raw: Record<string, unknown>): ToolManifestFacts {
  const parsed = parseManifestFacts({ manifestVersion: 2, ...raw })
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  return parsed.value
}

const PIPELINE = facts({
  bindings: {
    notes: { kind: 'folder', label: 'Deal notes', suggest: 'deals' },
    deal: { kind: 'type', label: 'Deal', suggest: 'Deal', fields: ['stage'] },
    crm: { kind: 'connector', label: 'CRM', recipe: 'hubspot' },
  },
  permissions: {
    context: { read: ['$notes/**', 'people/*/index.md'], write: ['$notes/**'] },
    records: { read: ['$deal', 'person'], write: [{ type: '$deal', fields: ['stage'] }] },
    connectors: [{ use: '$crm', actions: ['search_deals'] }],
    actions: ['list_events', 'update_event'],
    ai: { complete: true },
  },
})

const READER = facts({
  bindings: { notes: { kind: 'folder', label: 'Notes', suggest: 'notes' } },
  permissions: { context: { read: ['$notes/**'] }, actions: ['list_events'] },
})

test('where a listing request stands, read off its columns', () => {
  const at = new Date()
  assert.equal(listingRequestState({ listingRequestedAt: null, cosignedAt: null, marketplaceStatus: null }), 'none')
  assert.equal(listingRequestState({ listingRequestedAt: at, cosignedAt: null, marketplaceStatus: null }), 'awaiting_cosign')
  assert.equal(listingRequestState({ listingRequestedAt: at, cosignedAt: at, marketplaceStatus: 'pending' }), 'in_review')
  assert.equal(listingRequestState({ listingRequestedAt: at, cosignedAt: at, marketplaceStatus: 'approved' }), 'listed')
  assert.equal(listingRequestState({ listingRequestedAt: at, cosignedAt: at, marketplaceStatus: 'rejected' }), 'rejected')
  assert.equal(listingRequestState({ listingRequestedAt: at, cosignedAt: at, marketplaceStatus: 'withdrawn' }), 'withdrawn')
})

test('a license is an SPDX id or proprietary, spelled the common way', () => {
  assert.deepEqual(parseLicense('mit'), { ok: true, license: 'MIT' })
  assert.deepEqual(parseLicense('Proprietary'), { ok: true, license: 'proprietary' })
  assert.deepEqual(parseLicense('GPL-2.0-or-later'), { ok: true, license: 'GPL-2.0-or-later' })
  assert.deepEqual(parseLicense('MIT OR Apache-2.0'), { ok: true, license: 'MIT OR Apache-2.0' })
  assert.equal(parseLicense('').ok, false)
  assert.equal(parseLicense('do what you want!').ok, false)
  assert.equal(parseLicense(undefined).ok, false)
})

test('a new or unverified publisher’s listing starts staged; a verified publisher’s later ones do not', () => {
  const now = new Date('2026-09-26T00:00:00Z')
  const first = initialStage({ verified: false, publisherListings: 0, now })!
  assert.equal(first.stagedCap, STAGED_CAP)
  assert.equal(first.stagedUntil.getTime() - now.getTime(), STAGED_DAYS * 86_400_000)
  assert.ok(initialStage({ verified: true, publisherListings: 0, now }), 'a verified publisher’s first listing is staged')
  assert.ok(initialStage({ verified: false, publisherListings: 3, now }), 'an unverified publisher is staged every time')
  assert.equal(initialStage({ verified: true, publisherListings: 2, now }), null)
})

test('a staged listing reaches its cap and no further, and only while it is staged', () => {
  const now = new Date('2026-09-26T00:00:00Z')
  const staged = { stagedUntil: new Date('2026-10-01T00:00:00Z'), stagedCap: 25 }
  assert.ok(isStaged(staged, now))
  assert.equal(stagedInstallDenial({ listing: staged, spaces: 24, now }), null)
  assert.match(stagedInstallDenial({ listing: staged, spaces: 25, now }) ?? '', /25 spaces until 2026-10-01/)
  const over = { stagedUntil: new Date('2026-09-20T00:00:00Z'), stagedCap: 25 }
  assert.ok(!isStaged(over, now))
  assert.equal(stagedInstallDenial({ listing: over, spaces: 400, now }), null)
  assert.equal(stagedInstallDenial({ listing: null, spaces: 400, now }), null)
  assert.equal(stagedRate(120, true), 60)
  assert.equal(stagedRate(120, false), 120)
  assert.equal(stagedRate(1, true), 1)
})

test('what a Tool does as its viewer is its writes, edits, doors and AI — never its reads', () => {
  const acting = actingReachOf(resolveReach(PIPELINE, { notes: 'sales/deals', deal: 'Opportunity', crm: 'hubspot' }).reach, toolActionActs)
  assert.deepEqual(acting, {
    notes: ['sales/deals/**'],
    records: [{ type: 'Opportunity', fields: ['stage'] }],
    connectors: ['hubspot'],
    agents: [],
    actions: ['update_event'],
    ai: true,
  })
  assert.ok(actsAsViewer(acting))
  const reader = actingReachOf(resolveReach(READER, { notes: 'notes' }).reach, toolActionActs)
  assert.ok(!actsAsViewer(reader), 'a read-only Tool never asks')
})

test('a consent covers the same reach or less; a wider upgrade asks again', () => {
  const given = actingReachOf(resolveReach(PIPELINE, { notes: 'deals', deal: 'Deal', crm: 'hubspot' }).reach, toolActionActs)
  assert.ok(consentCovers(given, given))
  assert.ok(consentCovers(given, { ...given, connectors: [], ai: false }), 'narrower is covered')
  assert.ok(!consentCovers(given, { ...given, connectors: ['hubspot', 'slack'] }), 'a new connector asks')
  assert.ok(!consentCovers(given, { ...given, records: [{ type: 'Deal', fields: ['stage', 'value'] }] }), 'a new field asks')
  assert.ok(!consentCovers({ ...given, ai: false }, given), 'the AI asks')
})

test('the notice names the Tool, its publisher and what it does as you', () => {
  const acting = actingReachOf(resolveReach(PIPELINE, { notes: 'deals', deal: 'Deal', crm: 'hubspot' }).reach, toolActionActs)
  assert.equal(
    consentSentence({ title: 'Deal Pipeline', publisher: 'Acme Sales', acting }),
    'Deal Pipeline from Acme Sales will edit notes in deals/, edit Deal records, call hubspot, run update event and use the space’s AI as you.',
  )
  assert.equal(
    consentSentence({ title: 'Notes', publisher: null, acting: { notes: [], records: [], connectors: [], agents: [], actions: [], ai: true } }),
    'Notes will use the space’s AI as you.',
  )
})

test('the bridge methods that ask are the acting ones', () => {
  for (const method of ['context.write', 'context.append', 'records.update', 'connectors.call', 'agents.run', 'actions.run', 'ai.complete', 'ai.decide', 'data.call'] as const) {
    assert.ok(isActingMethod(method), method)
  }
  for (const method of ['context.read', 'context.list', 'context.search', 'records.query', 'records.get', 'resources.read', 'state.get', 'state.set', 'subject.get'] as const) {
    assert.ok(!isActingMethod(method), method)
  }
})

test('reach reads as sentences, each slot standing where its picker goes', () => {
  const sentences = reachSentences(PIPELINE)
  const text = sentences.map((parts) => parts.map((p) => (typeof p === 'string' ? p : `[${p.slot}]`)).join(''))
  assert.deepEqual(text, [
    'Reads and edits notes in [notes]',
    'Reads notes in people/*/index.md',
    'Reads [deal], person records',
    'Edits stage on [deal] records',
    'Calls [crm] (search deals)',
    'Runs list events and update event',
    'Uses the space’s AI',
  ])
  assert.deepEqual(reachSentences(facts({})), [])
})
