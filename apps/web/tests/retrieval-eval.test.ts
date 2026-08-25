// The retrieval regression gate. Runs the graded query set in
// tests/fixtures/retrievalCorpus.ts through the real fused stack and asserts
// the aggregate metrics have not slipped.
//
// The thresholds below are a RATCHET, not a target: they are set just under the
// numbers the current stack achieves, so any change that makes retrieval worse
// fails here, and any change that makes it better should be followed by raising
// them. If you are reading this because the gate went red, the useful output is
// the per-case report — run `pnpm eval:retrieval` for it.
//
// Run: node --import tsx --test tests/retrieval-eval.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { evaluateRetrieval, formatReport } from '../lib/notes/shared/evalRetrieval'
import { corpusNotes, QUERIES } from './fixtures/retrievalCorpus'

/**
 * Floors, deliberately just below the current numbers. Raise them when the
 * stack improves; never lower one without saying which case you gave up on and
 * why, because a threshold quietly relaxed is a regression that shipped.
 */
const FLOOR = {
  recall: 0.95,
  mrr: 0.9,
  ndcg: 0.9,
  orderAccuracy: 1,
}

test('retrieval: every graded query keeps its relevant hits and its order', async () => {
  const report = await evaluateRetrieval(corpusNotes(), QUERIES, 10)
  assert.equal(
    report.failures.length,
    0,
    `retrieval regressed on ${report.failures.length} case(s):\n\n${formatReport(report)}`,
  )
})

test('retrieval: aggregate metrics stay above their floors', async () => {
  const report = await evaluateRetrieval(corpusNotes(), QUERIES, 10)
  const detail = `\n\n${formatReport(report)}`
  assert.ok(report.recall >= FLOOR.recall, `recall ${report.recall.toFixed(3)} < ${FLOOR.recall}${detail}`)
  assert.ok(report.mrr >= FLOOR.mrr, `MRR ${report.mrr.toFixed(3)} < ${FLOOR.mrr}${detail}`)
  assert.ok(report.ndcg >= FLOOR.ndcg, `nDCG ${report.ndcg.toFixed(3)} < ${FLOOR.ndcg}${detail}`)
  assert.ok(
    report.orderAccuracy >= FLOOR.orderAccuracy,
    `order accuracy ${report.orderAccuracy.toFixed(3)} < ${FLOOR.orderAccuracy}${detail}`,
  )
})

test('evaluateRetrieval scores a perfect and an empty ranking correctly', async () => {
  // Guards the harness itself: a metric that cannot distinguish these two is not
  // measuring anything, and a silently broken harness is worse than none.
  const notes = corpusNotes()
  const perfect = await evaluateRetrieval(notes, [
    {
      id: 'exact',
      query: 'Northwind Traders',
      relevant: ['customers/northwind.md'],
      intent: 'self-check',
    },
  ])
  assert.equal(perfect.recall, 1)
  assert.equal(perfect.mrr, 1)

  const impossible = await evaluateRetrieval(notes, [
    {
      id: 'absent',
      query: 'quarterly hedgehog logistics',
      relevant: ['does/not/exist.md'],
      intent: 'self-check',
    },
  ])
  assert.equal(impossible.recall, 0)
  assert.equal(impossible.mrr, 0)
  assert.equal(impossible.failures.length, 1)
})
