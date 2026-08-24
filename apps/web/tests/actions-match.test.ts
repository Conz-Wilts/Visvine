// The matcher behind the gateway's PLAN mode.
//
// Pure and deterministic on purpose: routing a request must be free, instant,
// repeatable, and incapable of naming something that does not exist. The
// behavioural routing invariants live in tests/actions-recipes.test.ts, against
// the real catalogue; this file pins the mechanism itself.
//
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/actions-match.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
import { confidenceOf, kw, normalise, scoreCandidates } from '@/lib/actions/shared/match'

const CANDIDATES = [
  { id: 'connector', keywords: [...kw('creat|add', 'connector', 10), ...kw('connector', '', 2)] },
  { id: 'agent', keywords: kw('creat|add', 'agent', 10) },
]

test('a rule scores only when every one of its terms is present', () => {
  assert.deepEqual(scoreCandidates('create a connector', CANDIDATES), [{ id: 'connector', score: 12 }])
  // 'creat' alone is not the connector rule, and 'connector' alone is only the weak one.
  assert.deepEqual(scoreCandidates('tell me about the connector', CANDIDATES), [{ id: 'connector', score: 2 }])
  assert.deepEqual(scoreCandidates('create something', CANDIDATES), [])
})

test('terms are substrings, so a stem covers the whole conjugation', () => {
  for (const prompt of ['create a connector', 'creating a connector', 'created a connector']) {
    assert.equal(scoreCandidates(prompt, CANDIDATES)[0]?.score, 12, prompt)
  }
})

test('punctuation is flattened, so wording never decides the route', () => {
  assert.equal(normalise('Create a "connector", please!'), ' create a connector please ')
  assert.equal(scoreCandidates('Create a "connector"!', CANDIDATES)[0]?.id, 'connector')
})

test('ties break by id, so the same request always yields the same plan', () => {
  const tied = [
    { id: 'zebra', keywords: kw('thing', '', 5) },
    { id: 'apple', keywords: kw('thing', '', 5) },
  ]
  assert.deepEqual(scoreCandidates('a thing', tied).map((m) => m.id), ['apple', 'zebra'])
})

test('confidence is calibrated to the shipped weights', () => {
  // A decisive hit, unopposed.
  assert.equal(confidenceOf([{ id: 'a', score: 10 }]), 'high')
  // Decisive but matched — two recipes want this equally, so it is not decisive.
  assert.equal(confidenceOf([{ id: 'a', score: 10 }, { id: 'b', score: 10 }]), 'medium')
  assert.equal(confidenceOf([{ id: 'a', score: 5 }]), 'medium')
  // A bare mention of a noun is 2, and must never be acted on confidently.
  assert.equal(confidenceOf([{ id: 'a', score: 2 }]), 'low')
  assert.equal(confidenceOf([]), 'low')
})

test('a malformed candidate costs its own rule and nothing else', () => {
  const mixed = [{ id: 'ok', keywords: kw('thing', '', 5) }, { id: 'empty', keywords: [] }]
  assert.deepEqual(scoreCandidates('a thing', mixed), [{ id: 'ok', score: 5 }])
})
