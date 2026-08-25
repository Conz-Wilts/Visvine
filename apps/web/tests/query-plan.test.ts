// Unit tests for the query plan: temporal phrases → date range, the
// temporal-only decision, history intent, and coercion of an LLM rewrite.
// Run: node --import tsx --test tests/query-plan.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  coerceQueryRewrite,
  inDateRange,
  mergeRewrite,
  noteTimeOf,
  planQuery,
} from '../lib/notes/shared/queryPlan'

// Tuesday 25 August 2026, midday UTC.
const NOW = Date.UTC(2026, 7, 25, 12)
const day = (iso: string) => Date.parse(`${iso}T00:00:00.000Z`)
const dayEnd = (iso: string) => Date.parse(`${iso}T23:59:59.999Z`)

test('planQuery: no time words → no range, topic is the query', () => {
  const p = planQuery('pricing model', NOW)
  assert.equal(p.dateRange, null)
  assert.equal(p.temporalOnly, false)
  assert.equal(p.topic, 'pricing model')
  assert.equal(p.intent, 'current')
  assert.deepEqual(p.queries, ['pricing model'])
})

test('planQuery: yesterday / today are single days', () => {
  assert.deepEqual(planQuery('errors from yesterday', NOW).dateRange, { start: day('2026-08-24'), end: dayEnd('2026-08-24') })
  assert.deepEqual(planQuery('what did we ship today', NOW).dateRange, { start: day('2026-08-25'), end: dayEnd('2026-08-25') })
})

test('planQuery: last week is the previous calendar week, Monday to Sunday', () => {
  assert.deepEqual(planQuery('issues last week', NOW).dateRange, { start: day('2026-08-17'), end: dayEnd('2026-08-23') })
  // …and this week runs from Monday to now.
  assert.deepEqual(planQuery('this week', NOW).dateRange, { start: day('2026-08-24'), end: dayEnd('2026-08-25') })
})

test('planQuery: rolling windows — past week, last 7 days, last couple of months', () => {
  assert.deepEqual(planQuery('past week', NOW).dateRange, { start: day('2026-08-19'), end: dayEnd('2026-08-25') })
  assert.deepEqual(planQuery('bugs in the last 7 days', NOW).dateRange, { start: day('2026-08-19'), end: dayEnd('2026-08-25') })
  assert.deepEqual(planQuery('last couple of months', NOW).dateRange, { start: day('2026-06-25'), end: dayEnd('2026-08-25') })
})

test('planQuery: last month / last year are whole calendar units', () => {
  assert.deepEqual(planQuery('decisions last month', NOW).dateRange, { start: day('2026-07-01'), end: dayEnd('2026-07-31') })
  assert.deepEqual(planQuery('revenue last year', NOW).dateRange, { start: day('2025-01-01'), end: dayEnd('2025-12-31') })
})

test('planQuery: named months and years, with the most recent past instance', () => {
  assert.deepEqual(planQuery('logs in June 2024', NOW).dateRange, { start: day('2024-06-01'), end: dayEnd('2024-06-30') })
  // "in June" this year has happened; "in October" has not → last year's.
  assert.deepEqual(planQuery('seats in June', NOW).dateRange, { start: day('2026-06-01'), end: dayEnd('2026-06-30') })
  assert.deepEqual(planQuery('offsite in October', NOW).dateRange, { start: day('2025-10-01'), end: dayEnd('2025-10-31') })
  assert.deepEqual(planQuery('hires in 2025', NOW).dateRange, { start: day('2025-01-01'), end: dayEnd('2025-12-31') })
})

test('planQuery: explicit dates, both orders and ISO', () => {
  assert.deepEqual(planQuery('what happened on 2024-03-15', NOW).dateRange, { start: day('2024-03-15'), end: dayEnd('2024-03-15') })
  assert.deepEqual(planQuery('March 15 2024 meeting', NOW).dateRange, { start: day('2024-03-15'), end: dayEnd('2024-03-15') })
  assert.deepEqual(planQuery('meeting on 3rd Feb', NOW).dateRange, { start: day('2026-02-03'), end: dayEnd('2026-02-03') })
  assert.deepEqual(planQuery('notes from 2026-03', NOW).dateRange, { start: day('2026-03-01'), end: null })
})

test('planQuery: since / before give one bound; both together intersect', () => {
  assert.deepEqual(planQuery('customers since March', NOW).dateRange, { start: day('2026-03-01'), end: null })
  assert.deepEqual(planQuery('decisions before 2026-02-01', NOW).dateRange, { start: null, end: dayEnd('2026-02-01') })
  assert.deepEqual(planQuery('since January before March', NOW).dateRange, { start: day('2026-01-01'), end: dayEnd('2026-03-31') })
})

test('planQuery: a bare month name is not a date ("may", "March" the surname)', () => {
  assert.equal(planQuery('what may happen', NOW).dateRange, null)
  assert.equal(planQuery('Sarah March', NOW).dateRange, null)
})

test('planQuery: crossed bounds are nonsense → no range, query kept whole', () => {
  const p = planQuery('since June before March 2020', NOW)
  assert.equal(p.dateRange, null)
  assert.equal(p.topic, 'since June before March 2020')
})

test('planQuery: temporal-only when nothing topical survives the time words', () => {
  for (const q of ['what happened last week', 'yesterday', 'anything new in the last 3 days', 'updates this month']) {
    const p = planQuery(q, NOW)
    assert.equal(p.temporalOnly, true, q)
    assert.equal(p.topic, '', q)
  }
  const topical = planQuery('pricing changes last week', NOW)
  assert.equal(topical.temporalOnly, false)
  assert.equal(topical.topic, 'pricing changes')
})

test('planQuery: history intent is read from the phrasing', () => {
  for (const q of [
    'why did we stop charging per company',
    'what did the trial used to be',
    'old pricing model',
    'previously agreed discount',
    'history of the onboarding runbook',
  ]) {
    assert.equal(planQuery(q, NOW).intent, 'history', q)
  }
  assert.equal(planQuery('current pricing model', NOW).intent, 'current')
})

test('coerceQueryRewrite: keeps up to three clean alternates and a sane range', () => {
  const r = coerceQueryRewrite(
    {
      queries: ['Pricing Model', 'seat pricing', '  per-seat   price ', 'seat pricing', 'x'.repeat(300), 4, 'fifth'],
      dateRange: { start: '2026-06-01', end: '2026-06-30' },
    },
    'pricing model',
  )
  assert.ok(r)
  // The original is dropped (case-insensitively), whitespace collapsed, duplicates and junk removed, capped at 3.
  assert.deepEqual(r.queries, ['seat pricing', 'per-seat price', 'fifth'])
  assert.deepEqual(r.dateRange, { start: day('2026-06-01'), end: dayEnd('2026-06-30') })
})

test('coerceQueryRewrite: crossed or unparseable dates are dropped; nothing useful → null', () => {
  assert.equal(coerceQueryRewrite({ queries: [], dateRange: { start: 'soon', end: null } }, 'q'), null)
  assert.equal(coerceQueryRewrite({ dateRange: { start: '2026-07-01', end: '2026-06-01' } }, 'q'), null)
  assert.equal(coerceQueryRewrite('not an object', 'q'), null)
  assert.deepEqual(coerceQueryRewrite({ dateRange: { start: null, end: '2026-06-01' } }, 'q'), {
    queries: [],
    dateRange: { start: null, end: dayEnd('2026-06-01') },
  })
})

test('mergeRewrite: alternates are appended, a parsed date beats a guessed one', () => {
  const parsed = planQuery('seats in June', NOW)
  const merged = mergeRewrite(parsed, {
    queries: ['seat count', 'seats in june'],
    dateRange: { start: day('2020-01-01'), end: null },
  })
  assert.deepEqual(merged.queries, ['seats in June', 'seat count'])
  assert.deepEqual(merged.dateRange, parsed.dateRange)
  assert.equal(merged.temporalOnly, false)

  // …and fills the range in when the parser found none.
  const plain = planQuery('the offsite', NOW)
  const widened = mergeRewrite(plain, { queries: [], dateRange: { start: day('2026-05-01'), end: dayEnd('2026-05-03') } })
  assert.deepEqual(widened.dateRange, { start: day('2026-05-01'), end: dayEnd('2026-05-03') })
  assert.equal(mergeRewrite(plain, null), plain)
})

test('noteTimeOf prefers a frontmatter date over mtime; inDateRange honours open bounds', () => {
  assert.equal(noteTimeOf({ mtime: 5, frontmatter: { date: '2026-02-11' } }), day('2026-02-11'))
  assert.equal(noteTimeOf({ mtime: 5, frontmatter: { timestamp: '2026-02-11T10:00:00Z' } }), Date.parse('2026-02-11T10:00:00Z'))
  assert.equal(noteTimeOf({ mtime: 5, frontmatter: { date: 'whenever' } }), 5)
  assert.equal(inDateRange(10, { start: null, end: 10 }), true)
  assert.equal(inDateRange(11, { start: null, end: 10 }), false)
  assert.equal(inDateRange(11, { start: 11, end: null }), true)
})
