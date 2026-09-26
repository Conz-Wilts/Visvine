import test from 'node:test'
import assert from 'node:assert/strict'
import { parseScreenJudgment } from '../scripts/eval/tool-verdict'
import { RUBRIC, passes } from '@/lib/tools/shared/visualRubric'

const scores = Object.fromEntries(RUBRIC.map((r) => [r.key, 9]))
const screen = (name: string) => ({ screen: name, scores, fixes: [], summary: name })
const reply = (screens: unknown[]) => JSON.stringify({ screens, broken: [], fit: 'Fits the request' })

test('the eval requires exactly one complete judgment for each captured screen', () => {
  assert.equal(parseScreenJudgment(reply([screen('Board'), screen('New item')]), ['Board', 'New item']).verdict.score, 9)
  for (const screens of [[], [screen('Board')], [screen('Board'), screen('Board')], [screen('New item'), screen('Board')]]) {
    assert.throws(() => parseScreenJudgment(reply(screens), ['Board', 'New item']))
  }
  assert.throws(() => parseScreenJudgment(reply([{ ...screen('Board'), scores: { hierarchy: 9 } }]), ['Board']))
  assert.throws(() => parseScreenJudgment(reply([]), []))
})

test('a malformed or truncated judge answer is an evaluation failure', () => {
  for (const value of ['{}', 'null', 'No answer', '{"screens":', JSON.stringify({ screens: [screen('Board')] })]) {
    assert.throws(() => parseScreenJudgment(value, ['Board']))
  }
})

test('the eval retains broken controls and the worst screen category', () => {
  const answer = { screens: [screen('Board'), { ...screen('New item'), scores: { ...scores, affordance: 2 } }], broken: ['Submit is disabled'], fit: 'Matches' }
  const judged = parseScreenJudgment(JSON.stringify(answer), ['Board', 'New item'])
  assert.deepEqual(judged.broken, ['Submit is disabled'])
  assert.equal(passes(judged.verdict), false)
})


test('unambiguous shortened screen names still cover their captured screens', () => {
  const result = parseScreenJudgment(reply([screen('Board'), screen('New item dialog')]), ['the Board section', 'the dialog opened by pressing "New item"'])
  assert.deepEqual(result.screens.map((s) => s.screen), ['the Board section', 'the dialog opened by pressing "New item"'])
})


test('saved judgments may name the exact screenshot file shown in the prompt', () => {
  const result = parseScreenJudgment(reply([screen('vendor-list-0.png'), screen('vendor-list-1.png')]), ['the main page', 'the dialog opened by pressing "New vendor"'], ['vendor-list-0.png', 'vendor-list-1.png'])
  assert.equal(result.verdict.score, 9)
  assert.throws(() => parseScreenJudgment(reply([screen('vendor-list-1.png'), screen('vendor-list-0.png')]), ['the main page', 'the dialog opened by pressing "New vendor"'], ['vendor-list-0.png', 'vendor-list-1.png']))
})


test('structured responses can omit the article and escape a quoted action name twice', () => {
  const answer = reply([screen('dialog opened by pressing '+JSON.stringify('New item').replaceAll('"', String.fromCharCode(92)+'"'))])
  assert.equal(parseScreenJudgment(answer, ['the dialog opened by pressing "New item"']).verdict.score, 9)
})
