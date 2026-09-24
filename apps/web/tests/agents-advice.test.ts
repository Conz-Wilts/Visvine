/**
 * What to change about an agent (lib/agents/shared/advice.ts): a failed run's
 * cause in words, and the model a brief suits — from the space's own record
 * first, the brief's shape with no record.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/agents-advice.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { causeAdvice, recommendModel } from '@/lib/agents/shared/advice'
import { shortOf } from '@/lib/agents/shared/runCheck'
import { parseAgentBrief } from '@/lib/agents/config'

const FLASH = 'openrouter/google/gemini-2.5-flash'
const NEW_FLASH = 'openrouter/google/gemini-3.8-flash'
const LITE = 'openrouter/google/gemini-3.5-flash-lite'
const SONNET = 'openrouter/anthropic/claude-sonnet-5'

test('a model that finishes where this one does not is recommended, as a fallback while this one mostly works', () => {
  const runnable = [FLASH, NEW_FLASH]
  const weak = recommendModel({
    current: FLASH, fallback: null, runnable, shape: null,
    tracks: [{ model: FLASH, finished: 2, short: 3 }, { model: NEW_FLASH, finished: 9, short: 0 }],
  })
  assert.equal(weak?.model, NEW_FLASH)
  assert.equal(weak?.as, 'model', 'a model finishing under 70% is replaced')
  assert.match(weak?.why ?? '', /9 of 9.*2 of 5/)

  const mostly = recommendModel({
    current: FLASH, fallback: null, runnable, shape: null,
    tracks: [{ model: FLASH, finished: 8, short: 2 }, { model: NEW_FLASH, finished: 10, short: 0 }],
  })
  assert.equal(mostly, null, 'finishing 80% is not beaten by 20 points')

  const fallback = recommendModel({
    current: FLASH, fallback: null, runnable, shape: null,
    tracks: [{ model: FLASH, finished: 7, short: 3 }, { model: NEW_FLASH, finished: 10, short: 0 }],
  })
  assert.equal(fallback?.as, 'fallback')
  assert.equal(
    recommendModel({ current: FLASH, fallback: NEW_FLASH, runnable, shape: null, tracks: [{ model: FLASH, finished: 7, short: 3 }, { model: NEW_FLASH, finished: 10, short: 0 }] }),
    null,
    'already its fallback',
  )
})

test('with no record, a heavy brief on a light model gets a heavier fallback; nothing else is said', () => {
  const heavy = recommendModel({ current: LITE, fallback: null, runnable: [LITE, SONNET], tracks: [], shape: 'heavy' })
  assert.deepEqual(heavy && { model: heavy.model, as: heavy.as }, { model: SONNET, as: 'fallback' })
  assert.equal(recommendModel({ current: LITE, fallback: null, runnable: [LITE, SONNET], tracks: [], shape: 'simple' }), null)
  assert.equal(recommendModel({ current: SONNET, fallback: null, runnable: [LITE, SONNET], tracks: [], shape: 'heavy' }), null)
  assert.equal(recommendModel({ current: null, fallback: null, runnable: [LITE], tracks: [], shape: 'heavy' }), null)
})

test('every cause says what to change, and "other" says nothing', () => {
  for (const cause of ['model', 'access', 'source', 'brief'] as const) assert.match(causeAdvice(cause) ?? '', /^Likely cause: /)
  assert.equal(causeAdvice('other'), null)
})

test('shortOf: the trace and last words first, then the verdict', () => {
  const base = { reason: 'finished' as const, finalText: 'Wrote it.', writes: 1, maxTurns: 12, verdict: null, promisesMore: false }
  assert.equal(shortOf(base), null)
  assert.match(shortOf({ ...base, reason: 'max_turns', writes: 0 }) ?? '', /all 12 turns/)
  assert.match(shortOf({ ...base, finalText: null, writes: 0 }) ?? '', /without a word/)
  assert.match(shortOf({ ...base, writes: 0, promisesMore: true }) ?? '', /announcing work/)
  assert.match(shortOf({ ...base, verdict: { unbacked: [], outcome: 'partial' } }) ?? '', /part of the job/)
})

test('fallback_model is part of the record and parses like model', () => {
  const ok = parseAgentBrief({ type: 'agent', fallback_model: 'openrouter/google/gemini-3.8-flash' }, 'Do it.')
  assert.ok(ok.ok && ok.brief.fallbackModel === 'openrouter/google/gemini-3.8-flash')
  assert.equal(parseAgentBrief({ type: 'agent', fallback_model: 'nonsense' }, 'Do it.').ok, false)
})
