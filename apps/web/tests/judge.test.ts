// The judge's pure half: what a model's answers are allowed to become.
// Run: node --import tsx --test tests/judge.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { coerceAnswers, choiceOf, noulOf, scoreOf, type JudgeQuestions } from '../lib/judge/shared/types'
import { compareAcrossSearches, type FusedResult } from '../lib/notes/shared/retrieval'

const asked: JudgeQuestions = {
  yes: { type: 'noul', instructions: 'Is it?' },
  kind: { type: 'choice', instructions: 'Which?', criteria: { a: 'A', b: 'B' } },
  level: { type: 'score', instructions: 'How?', criteria: ['low', 'mid', 'high'] },
}

test('coerceAnswers keeps answers of the asked shape, in range, and nothing else', () => {
  const out = coerceAnswers(
    {
      yes: { type: 'noul', noul: 0.8 },
      kind: { type: 'choice', choice: 'b', probabilities: { a: 0.1, b: 0.9, z: 1 }, confidence: 0.7 },
      level: { type: 'score', score: 1.4, confidence: 0.5 },
      extra: { type: 'noul', noul: 1 },
    },
    asked,
  )
  assert.equal(noulOf(out, 'yes'), 0.8)
  assert.deepEqual(choiceOf(out, 'kind'), { type: 'choice', choice: 'b', probabilities: { a: 0.1, b: 0.9 }, confidence: 0.7 })
  assert.equal(scoreOf(out, 'level')?.score, 1.4)
  assert.equal('extra' in out, false)
})

test('coerceAnswers drops a wrong shape, an out-of-range number and an option never offered', () => {
  const out = coerceAnswers(
    {
      yes: { type: 'noul', noul: 1.2 },
      kind: { type: 'choice', choice: 'c' },
      level: { type: 'noul', noul: 0.5 },
    },
    asked,
  )
  assert.deepEqual(out, {})
  assert.equal(noulOf(null, 'yes'), undefined)
  assert.deepEqual(coerceAnswers('nonsense', asked), {})
})

test('compareAcrossSearches: judged hits lead by relevance, the rest follow by score', () => {
  const hit = (path: string, score: number, relevance?: number): FusedResult => ({ path, title: path, score, kind: 'note', ...(relevance === undefined ? {} : { relevance }) })
  const sorted = [hit('plain-high', 9), hit('judged-low', 0.1, 0.4), hit('plain-low', 1), hit('judged-high', 0.01, 0.9)].sort(compareAcrossSearches)
  assert.deepEqual(sorted.map((h) => h.path), ['judged-high', 'judged-low', 'plain-high', 'plain-low'])
})
