/**
 * The agent note contract (lib/agents/config.ts) and the model registry
 * (lib/agents/registry.ts): pure parsers, schedule math with the two DST
 * rules, and the note templates round-tripping through the parsers.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/agents-config.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  describeSchedule,
  newActivationNote,
  newAgentNote,
  nextOccurrence,
  parseAgentActivation,
  parseAgentBrief,
  scheduleHash,
  wallClockAt,
  zonedWallToInstant,
} from '@/lib/agents/config'
import { parseModelRef } from '@/lib/agents/registry'
import { parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'

// ── registry ──

test('parseModelRef accepts provider/model and rejects the rest', () => {
  const ok = parseModelRef('gemini/gemma-4-31b-it')
  assert.ok(ok.ok)
  if (ok.ok) {
    assert.equal(ok.ref.provider.id, 'gemini')
    assert.equal(ok.ref.modelId, 'gemma-4-31b-it')
  }
  const priced = parseModelRef('anthropic/claude-sonnet-5')
  assert.ok(priced.ok && priced.ref.pricing?.inputPerM === 3)
  const unknownModel = parseModelRef('openai/some-future-model')
  assert.ok(unknownModel.ok && unknownModel.ref.pricing === null, 'unknown ids under a known provider pass through')
  for (const bad of ['', 'gemini', '/x', 'gemini/', 'https://evil.example/v1', 'nope/model']) {
    assert.equal(parseModelRef(bad).ok, false, bad)
  }
})

// ── brief ──

const BRIEF = `---
type: agent
title: Weekly digest
description: Summarises the week
model: gemini/gemma-4-31b-it
connectors: [hubspot, stripe]
tools: [web]
max_turns: 8
---
Read the week's notes and write a digest to reports/weekly.md.
`

test('parseAgentBrief reads a well-formed brief', () => {
  const { frontmatter, body } = splitFrontmatter(BRIEF)
  const r = parseAgentBrief(parseFrontmatter(`---\n${frontmatter}\n---\n`), body)
  assert.ok(r.ok, JSON.stringify(r))
  if (r.ok) {
    assert.equal(r.brief.title, 'Weekly digest')
    assert.deepEqual(r.brief.connectors, ['hubspot', 'stripe'])
    assert.deepEqual(r.brief.tools, ['web'])
    assert.equal(r.brief.maxTurns, 8)
    assert.match(r.brief.body, /^Read the week/)
  }
})

test('parseAgentBrief describes what is wrong instead of vanishing', () => {
  const cases: [Record<string, unknown>, string, RegExp][] = [
    [{ type: 'connector', model: 'gemini/x' }, 'body', /type: agent/],
    [{ type: 'agent' }, 'body', /model/],
    [{ type: 'agent', model: 'https://evil/v1' }, 'body', /provider/],
    [{ type: 'agent', model: 'gemini/x', tools: ['shell'] }, 'body', /unknown tool/],
    [{ type: 'agent', model: 'gemini/x', max_turns: 99 }, 'body', /max_turns/],
    [{ type: 'agent', model: 'gemini/x', connectors: ['bad name!'] }, 'body', /connector name/],
    [{ type: 'agent', model: 'gemini/x' }, '   ', /empty/],
  ]
  for (const [fm, body, re] of cases) {
    const r = parseAgentBrief(fm, body)
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.error, re)
  }
})

test('newAgentNote round-trips through the parser', () => {
  const md = newAgentNote({ name: 'digest', title: 'Digest', description: 'd', connectors: ['hubspot'], tools: ['web'] })
  const { frontmatter, body } = splitFrontmatter(md)
  const r = parseAgentBrief(parseFrontmatter(`---\n${frontmatter}\n---\n`), body)
  assert.ok(r.ok, JSON.stringify(r))
  if (r.ok) assert.deepEqual(r.brief.connectors, ['hubspot'])
})

// ── activation ──

test('parseAgentActivation reads hourly / daily / weekly and enforces the rules', () => {
  const daily = parseAgentActivation({ active: true, schedule: 'daily', at: '07:00', timezone: 'Pacific/Auckland' })
  assert.ok(daily.ok)
  if (daily.ok) {
    assert.deepEqual(daily.activation.schedule, { kind: 'daily', hour: 7, minute: 0 })
    assert.equal(daily.activation.timezone, 'Pacific/Auckland')
  }
  const weekly = parseAgentActivation({ active: false, schedule: 'weekly', at: '9:30', on: 'Monday' })
  assert.ok(weekly.ok && weekly.activation.schedule?.kind === 'weekly' && weekly.activation.schedule.weekday === 1)
  const hourly = parseAgentActivation({ active: true, schedule: 'hourly' })
  assert.ok(hourly.ok && hourly.activation.schedule?.kind === 'hourly')

  assert.equal(parseAgentActivation({ active: true }).ok, false, 'active needs a schedule')
  assert.equal(parseAgentActivation({ schedule: 'daily' }).ok, false, 'daily needs at')
  assert.equal(parseAgentActivation({ schedule: 'weekly', at: '07:00' }).ok, false, 'weekly needs on')
  assert.equal(parseAgentActivation({ schedule: 'cron' }).ok, false)
  assert.equal(parseAgentActivation({ timezone: 'Mars/Olympus' }).ok, false)
  const off = parseAgentActivation({})
  assert.ok(off.ok && off.activation.active === false && off.activation.schedule === null)
})

test('newActivationNote round-trips and scheduleHash is stable', () => {
  const md = newActivationNote({ active: true, schedule: { kind: 'weekly', hour: 9, minute: 30, weekday: 1 }, timezone: 'UTC' })
  const r = parseAgentActivation(parseFrontmatter(md))
  assert.ok(r.ok, JSON.stringify(r))
  if (r.ok) {
    assert.deepEqual(r.activation.schedule, { kind: 'weekly', hour: 9, minute: 30, weekday: 1 })
    assert.equal(scheduleHash(r.activation, 'UTC'), scheduleHash(r.activation, 'UTC'))
    assert.notEqual(scheduleHash(r.activation, 'UTC'), scheduleHash({ ...r.activation, active: false }, 'UTC'))
  }
})

// ── schedule math ──

test('wallClockAt reads the zone correctly', () => {
  const w = wallClockAt(new Date('2026-01-15T20:00:00Z'), 'Pacific/Auckland') // NZDT = UTC+13
  assert.deepEqual([w.year, w.month, w.day, w.hour, w.minute], [2026, 1, 16, 9, 0])
})

test('hourly fires at the next top of hour', () => {
  const next = nextOccurrence({ kind: 'hourly' }, new Date('2026-08-17T10:15:00Z'), 'UTC')
  assert.equal(next.toISOString(), '2026-08-17T11:00:00.000Z')
})

test('daily fires at the wall-clock time in the zone, strictly after now', () => {
  // 07:00 NZST (UTC+12) on 18 Aug = 19:00Z on 17 Aug
  const next = nextOccurrence({ kind: 'daily', hour: 7, minute: 0 }, new Date('2026-08-17T10:00:00Z'), 'Pacific/Auckland')
  assert.equal(next.toISOString(), '2026-08-17T19:00:00.000Z')
  // Exactly at the moment → the NEXT day, never the same instant.
  const again = nextOccurrence({ kind: 'daily', hour: 7, minute: 0 }, next, 'Pacific/Auckland')
  assert.equal(again.toISOString(), '2026-08-18T19:00:00.000Z')
})

test('weekly picks the right weekday', () => {
  // 2026-08-17 is a Monday. Weekly on Wednesday 09:00 UTC → 2026-08-19T09:00Z.
  const next = nextOccurrence({ kind: 'weekly', hour: 9, minute: 0, weekday: 3 }, new Date('2026-08-17T10:00:00Z'), 'UTC')
  assert.equal(next.toISOString(), '2026-08-19T09:00:00.000Z')
  // A Monday schedule computed on Monday after the time → next Monday.
  const mon = nextOccurrence({ kind: 'weekly', hour: 9, minute: 0, weekday: 1 }, new Date('2026-08-17T10:00:00Z'), 'UTC')
  assert.equal(mon.toISOString(), '2026-08-24T09:00:00.000Z')
})

test('spring forward: a wall time that does not exist fires at the next instant that does', () => {
  // NZ springs forward 2026-09-27 at 02:00 → 03:00 (NZST→NZDT). 02:30 doesn't exist.
  const instant = zonedWallToInstant('Pacific/Auckland', 2026, 9, 27, 2, 30)
  const w = wallClockAt(instant, 'Pacific/Auckland')
  assert.deepEqual([w.hour, w.minute], [3, 30])
  assert.equal(instant.toISOString(), '2026-09-26T14:30:00.000Z')
})

test('fall back: a wall time that happens twice fires on the FIRST occurrence only', () => {
  // NZ falls back 2026-04-05 at 03:00 NZDT → 02:00 NZST. 02:30 happens twice:
  // 13:30Z (NZDT, first) and 14:30Z (NZST, second).
  const instant = zonedWallToInstant('Pacific/Auckland', 2026, 4, 5, 2, 30)
  assert.equal(instant.toISOString(), '2026-04-04T13:30:00.000Z')
  // And dispatch after the first occurrence advances past the second one.
  const next = nextOccurrence({ kind: 'daily', hour: 2, minute: 30 }, instant, 'Pacific/Auckland')
  assert.equal(next.toISOString(), '2026-04-05T14:30:00.000Z') // 02:30 NZST next day
})

test('describeSchedule renders for the roster', () => {
  assert.equal(describeSchedule({ kind: 'hourly' }, null), 'Every hour')
  assert.equal(describeSchedule({ kind: 'daily', hour: 7, minute: 5 }, 'UTC'), 'Daily at 07:05 (UTC)')
  assert.equal(describeSchedule({ kind: 'weekly', hour: 9, minute: 30, weekday: 1 }, null), 'Weekly on Monday at 09:30')
})
