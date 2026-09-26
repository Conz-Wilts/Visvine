/**
 * The visual review's pure half (lib/tools/shared/visualRubric.ts): the answer
 * read however a model wraps it, scores clamped, several screens folded into
 * one verdict that is only as good as its worst category.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-visual-rubric.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { combineVerdicts, parseVerdict, passes, reviewPrompt, RUBRIC } from '@/lib/tools/shared/visualRubric'

const all = (n: number) => Object.fromEntries(RUBRIC.map((r) => [r.key, n]))

test('an answer wrapped in prose or a fence is read', () => {
  const text = 'Here you go:\n```json\n' + JSON.stringify({ summary: 'A board', scores: all(8), fixes: ['Right-align Value'] }) + '\n```'
  const v = parseVerdict(text)
  assert.ok(v)
  assert.equal(v.score, 8)
  assert.deepEqual(v.fixes, ['Right-align Value'])
})

test('scores are clamped to 0–10 and a missing criterion is no verdict', () => {
  const v = parseVerdict(JSON.stringify({ scores: { ...all(7), polish: 14 } }))
  assert.equal(v?.scores.polish, 10)
  const partial = all(7)
  delete partial.polish
  assert.equal(parseVerdict(JSON.stringify({ scores: partial })), null)
  assert.equal(parseVerdict('no json here'), null)
})

test('screens fold into one verdict: mean score, fixes in order without repeats', () => {
  const a = parseVerdict(JSON.stringify({ scores: all(9), fixes: ['A', 'B'] }))!
  const b = parseVerdict(JSON.stringify({ scores: all(7), fixes: ['b', 'C'] }))!
  const v = combineVerdicts([a, b])!
  assert.equal(v.score, 8)
  assert.deepEqual(v.fixes, ['A', 'B', 'C'])
  assert.equal(combineVerdicts([]), null)
})

test('passing needs the bar AND no category under 6', () => {
  assert.equal(passes(parseVerdict(JSON.stringify({ scores: all(9) }))!), true)
  assert.equal(passes(parseVerdict(JSON.stringify({ scores: all(8) }))!), false)
  assert.equal(passes(parseVerdict(JSON.stringify({ scores: { ...all(10), data: 5 } }))!), false)
})

test('the prompt names the request, the screen and every criterion', () => {
  const p = reviewPrompt({ request: 'crm', title: 'Deals', screen: 'the Board section' })
  assert.ok(p.includes('"crm"') && p.includes('the Board section'))
  for (const r of RUBRIC) assert.ok(p.includes(r.key))
})


test('a failed category on one screen cannot be averaged into a pass', () => {
  const bad = parseVerdict(JSON.stringify({ scores: { ...all(10), data: 2 } }))!
  const good = parseVerdict(JSON.stringify({ scores: all(10) }))!
  const combined = combineVerdicts([bad, good, good])!
  assert.ok(combined.score >= 9)
  assert.equal(passes(combined), false)
})

test('missing numeric judgments are not silently converted to zero', () => {
  for (const data of [null, '', false, '9']) {
    assert.equal(parseVerdict(JSON.stringify({ scores: { ...all(9), data } })), null)
  }
})
