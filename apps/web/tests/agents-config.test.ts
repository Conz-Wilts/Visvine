/**
 * The agent note contract (lib/agents/config.ts) and the model registry
 * (lib/agents/registry.ts): pure parsers, schedule math with the two DST
 * rules, and the note templates round-tripping through the parsers.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/agents-config.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  agentNameOfHref,
  agentPageHref,
  describeSchedule,
  describeTriggers,
  globProblem,
  globToRegExp,
  matchesAnyGlob,
  withActivation,
  parseEvery,
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

test('a gateway model id keeps its own namespace', () => {
  // Only the first slash separates provider from model. A gateway namespaces
  // its models by vendor, and the rest of the id belongs to the model — it is
  // sent in the request body, never in a URL path.
  const gateway = parseModelRef('custom/z-ai/glm-5.3-flash')
  assert.ok(gateway.ok)
  if (gateway.ok) {
    assert.equal(gateway.ref.provider.id, 'custom')
    assert.equal(gateway.ref.modelId, 'z-ai/glm-5.3-flash')
  }
  for (const bad of ['custom//model', 'custom/vendor/', 'custom/vendor//model']) {
    assert.equal(parseModelRef(bad).ok, false, bad)
  }
})

test('the mirrored Gemini literals in registry.ts and ai.ts stay identical', () => {
  // lib/agents/registry.ts hand-copies these from lib/notes/ai.ts because it
  // must stay pure; nothing else ties them together, so this does.
  const literal = (source: string, name: string): string => {
    const match = source.match(new RegExp(`const ${name} = '([^']+)'`))
    assert.ok(match, `${name} not found`)
    return match![1]
  }
  const ai = readFileSync(new URL('../lib/notes/ai.ts', import.meta.url), 'utf8')
  const registry = readFileSync(new URL('../lib/agents/registry.ts', import.meta.url), 'utf8')
  for (const name of ['GEMINI_BASE_URL', 'DEFAULT_GEMINI_MODEL']) {
    assert.equal(literal(registry, name), literal(ai, name), name)
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
    [{ type: 'agent', model: 'gemini/x', max_turns: 500 }, 'body', /max_turns/],
    [{ type: 'agent', model: 'gemini/x', connectors: ['bad name!'] }, 'body', /connector name/],
    [{ type: 'agent', model: 'gemini/x' }, '   ', /empty/],
    [{ type: 'agent', model: 'gemini/x', agents: ['Bad Name'] }, 'body', /agent name/],
    [{ type: 'agent', model: 'gemini/x', dry_run: 'maybe' }, 'body', /dry_run/],
  ]
  for (const [fm, body, re] of cases) {
    const r = parseAgentBrief(fm, body)
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.error, re)
  }
})

test('parseAgentBrief reads agents:, dry_run and the new tool extras', () => {
  const r = parseAgentBrief(
    { type: 'agent', model: 'gemini/x', tools: ['messages', 'directory'], agents: ['digest', 'digest'], dry_run: true },
    'body',
  )
  assert.ok(r.ok, JSON.stringify(r))
  if (r.ok) {
    assert.deepEqual(r.brief.tools, ['messages', 'directory'])
    assert.deepEqual(r.brief.agents, ['digest'])
    assert.equal(r.brief.dryRun, true)
  }
  const plain = parseAgentBrief({ type: 'agent', model: 'gemini/x' }, 'body')
  assert.ok(plain.ok && plain.brief.agents.length === 0 && plain.brief.dryRun === false)
})

test('agentPageHref / agentNameOfHref round-trip', () => {
  assert.equal(agentNameOfHref(agentPageHref('weekly-digest')), 'weekly-digest')
  assert.equal(agentNameOfHref('/directory/agent:weekly-digest?tab=context'), 'weekly-digest')
  assert.equal(agentNameOfHref('/directory/person:jane'), null)
  assert.equal(agentNameOfHref(null), null)
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

test('withActivation round-trips through the brief and scheduleHash is stable', () => {
  const md = withActivation(
    '---\ntype: agent\nmodel: gemini/gemma-4-31b-it\n---\n\nBody.\n',
    { active: true, schedule: { kind: 'weekly', hour: 9, minute: 30, weekday: 1 }, timezone: 'UTC' },
  )
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

// ── triggers: `every`, `on` map, `debounce`, globs, cron ──

test('parseAgentActivation: `every` is an interval or a cron, exclusive with `schedule`', () => {
  const m15 = parseAgentActivation({ active: true, every: '15m' })
  assert.ok(m15.ok, JSON.stringify(m15))
  if (m15.ok) {
    assert.deepEqual(m15.activation.schedule, { kind: 'interval', minutes: 15 })
    assert.equal(m15.activation.every, '15m')
    assert.equal(m15.activation.on, null)
    assert.equal(m15.activation.debounceMs, 60_000)
  }
  const h2 = parseAgentActivation({ active: true, every: '2h' })
  assert.ok(h2.ok && h2.activation.schedule?.kind === 'interval' && h2.activation.schedule.minutes === 120)
  const cron = parseAgentActivation({ active: true, every: '*/10 9-17 * * 1-5' })
  assert.ok(cron.ok, JSON.stringify(cron))
  if (cron.ok && cron.activation.schedule?.kind === 'cron') {
    assert.deepEqual(cron.activation.schedule.fields.minutes, [0, 10, 20, 30, 40, 50])
    assert.deepEqual(cron.activation.schedule.fields.hours, [9, 10, 11, 12, 13, 14, 15, 16, 17])
    assert.equal(cron.activation.schedule.fields.daysOfMonth, null)
    assert.deepEqual(cron.activation.schedule.fields.daysOfWeek, [1, 2, 3, 4, 5])
  } else assert.fail('expected cron')
  assert.ok(parseAgentActivation({ active: true, every: '4m' }).ok, 'a 4-minute interval is fine')
  assert.equal(parseAgentActivation({ active: true, every: '0m' }).ok, false, 'below the 1m floor')
  assert.equal(parseAgentActivation({ active: true, every: '25h' }).ok, false, 'above 24h')
  assert.equal(parseAgentActivation({ active: true, every: '* * *' }).ok, false, 'not 5 fields')
  assert.equal(parseAgentActivation({ active: true, every: '61 * * * *' }).ok, false, 'minute out of range')
  assert.equal(parseAgentActivation({ active: true, schedule: 'hourly', every: '15m' }).ok, false, 'schedule XOR every')
})

test('parseEvery: the floor is one minute — the tick\'s own cadence', () => {
  // Every minute is as often as anything can be: the tick fires once a minute,
  // so a cron below that would be a schedule the platform cannot honour.
  for (const expr of ['* * * * *', '*/4 * * * *', '0,3 * * * *', '58,0 * * * *', '*/5 * * * *', '0 9 * * 1', '*/10 9-17 * * 1-5']) {
    assert.ok(parseEvery(expr).ok, expr)
  }
  assert.equal(parseEvery('* * *').ok, false, 'not 5 fields')
  assert.equal(parseEvery('0m').ok, false, 'no interval at all')
})

test('parseAgentActivation: `on` map (context globs / webhook), debounce, and the >=1-of rule', () => {
  const r = parseAgentActivation({ active: true, on: { context: ['people/**', 'updates/*.md'], webhook: 'hubspot' }, debounce: '2m' })
  assert.ok(r.ok, JSON.stringify(r))
  if (r.ok) {
    assert.equal(r.activation.schedule, null)
    assert.deepEqual(r.activation.on, { context: ['people/**', 'updates/*.md'], webhook: 'hubspot' })
    assert.equal(r.activation.debounceMs, 120_000)
  }
  // bare string keeps the weekly meaning; the map can carry the weekday too
  const weekly = parseAgentActivation({ active: true, schedule: 'weekly', at: '09:00', on: { weekday: 'friday', context: ['people/**'] } })
  assert.ok(weekly.ok && weekly.activation.schedule?.kind === 'weekly' && weekly.activation.schedule.weekday === 5 && weekly.activation.on?.context.length === 1)
  assert.equal(parseAgentActivation({ active: true, on: { context: ['agents/**'] } }).ok, false, 'glob under agents/ refused')
  assert.equal(parseAgentActivation({ active: true, on: { context: ['**'] } }).ok, false, '** can match agents/, refused')
  assert.equal(parseAgentActivation({ active: true, on: { webhook: 'Not Valid!' } }).ok, false)
  assert.equal(parseAgentActivation({ active: true, on: { bogus: 1 } }).ok, false)
  assert.equal(parseAgentActivation({ active: true, on: {} }).ok, false, 'empty map')
  assert.equal(parseAgentActivation({ active: true, on: 'tuesday' }).ok, false, 'weekday alone is not a trigger and no schedule')
  assert.equal(parseAgentActivation({ active: true, on: { webhook: 'x' }, debounce: '45m' }).ok, false, 'debounce max 30m')
  assert.equal(parseAgentActivation({ active: true, on: { webhook: 'x' }, debounce: '1s' }).ok, false, 'debounce min 5s')
  const inactive = parseAgentActivation({ active: false, on: { webhook: 'x' } })
  assert.ok(inactive.ok && inactive.activation.on?.webhook === 'x')
})

test('globToRegExp / matchesAnyGlob / globProblem', () => {
  assert.ok(globToRegExp('people/**').test('people/alice.md'))
  assert.ok(globToRegExp('people/**').test('people/alice/index.md'))
  assert.ok(!globToRegExp('people/**').test('peopleX/alice.md'))
  assert.ok(globToRegExp('people/*').test('people/alice.md'))
  assert.ok(!globToRegExp('people/*').test('people/alice/notes.md'))
  assert.ok(globToRegExp('**/index.md').test('index.md'))
  assert.ok(globToRegExp('**/index.md').test('a/b/index.md'))
  assert.ok(globToRegExp('updates/*.md').test('updates/w1.md'))
  assert.ok(!globToRegExp('updates/*.md').test('updates/w1.txt'))
  assert.ok(!globToRegExp('a.b').test('aXb'), 'dots are literal')
  assert.ok(matchesAnyGlob('people/alice.md', ['reports/**', 'people/**']))
  assert.ok(!matchesAnyGlob('agents/x.md', ['*/*']), 'agents/ never matches even when a glob would')
  assert.equal(globProblem('people/**'), null)
  assert.match(globProblem('*/**') ?? '', /agents/)
  assert.match(globProblem('') ?? '', /empty/)
  assert.match(globProblem('a/../b') ?? '', /\.\./)
})

test('nextOccurrence: interval aligns to the clock grid; cron respects fields and zone', () => {
  const t = new Date('2026-08-19T10:07:00Z')
  assert.equal(nextOccurrence({ kind: 'interval', minutes: 15 }, t, 'UTC').toISOString(), '2026-08-19T10:15:00.000Z')
  assert.equal(nextOccurrence({ kind: 'interval', minutes: 60 }, new Date('2026-08-19T10:00:00Z'), 'UTC').toISOString(), '2026-08-19T11:00:00.000Z')
  const every = parseEvery('*/10 9-17 * * 1-5')
  assert.ok(every.ok)
  if (!every.ok) return
  // Wed 19 Aug 2026 10:07 UTC -> 10:10
  assert.equal(nextOccurrence(every.schedule, t, 'UTC').toISOString(), '2026-08-19T10:10:00.000Z')
  // Fri 21 Aug 17:55 -> skips the weekend -> Mon 24 Aug 09:00
  assert.equal(nextOccurrence(every.schedule, new Date('2026-08-21T17:55:00Z'), 'UTC').toISOString(), '2026-08-24T09:00:00.000Z')
  // In Auckland (UTC+12 in August): 09:00 local = 21:00Z the previous day
  const akl = parseEvery('0 9 * * *')
  assert.ok(akl.ok)
  if (akl.ok) assert.equal(nextOccurrence(akl.schedule, new Date('2026-08-19T10:00:00Z'), 'Pacific/Auckland').toISOString(), '2026-08-19T21:00:00.000Z')
  // day-of-month + month
  const nye = parseEvery('30 23 31 12 *')
  assert.ok(nye.ok)
  if (nye.ok) assert.equal(nextOccurrence(nye.schedule, t, 'UTC').toISOString(), '2026-12-31T23:30:00.000Z')
})

/** A minimal valid brief, for the activation-into-the-brief round trips. */
const BRIEF_MD = '---\ntype: agent\ntitle: Digest\nmodel: gemini/gemma-4-31b-it\n---\n\nDo the thing.\n'

test('scheduleHash covers every / on / debounce; withActivation round-trips triggers into the brief', () => {
  const base = parseAgentActivation({ active: true, every: '15m', on: { context: ['people/**'], webhook: 'hubspot' }, debounce: '2m' })
  assert.ok(base.ok)
  if (!base.ok) return
  const h = scheduleHash(base.activation, 'UTC')
  assert.notEqual(h, scheduleHash({ ...base.activation, on: { context: ['orgs/**'], webhook: 'hubspot' } }, 'UTC'))
  assert.notEqual(h, scheduleHash({ ...base.activation, every: '30m', schedule: { kind: 'interval', minutes: 30 } }, 'UTC'))
  assert.notEqual(h, scheduleHash({ ...base.activation, debounceMs: 5_000 }, 'UTC'))

  const md = withActivation(BRIEF_MD, { active: true, schedule: base.activation.schedule, on: base.activation.on, debounceMs: 120_000, timezone: null })
  const back = parseAgentActivation(parseFrontmatter(md))
  // The brief half is still there and still parses — one note, two readers.
  assert.match(md, /type: agent/)
  assert.match(md, /Do the thing\./)
  assert.ok(back.ok, JSON.stringify(back) + '\n' + md)
  if (back.ok) {
    assert.deepEqual(back.activation.schedule, { kind: 'interval', minutes: 15 })
    assert.deepEqual(back.activation.on, { context: ['people/**'], webhook: 'hubspot' })
    assert.equal(back.activation.debounceMs, 120_000)
  }
  const cron = parseEvery('*/10 * * * *')
  assert.ok(cron.ok)
  if (!cron.ok) return
  const cronBack = parseAgentActivation(parseFrontmatter(withActivation(BRIEF_MD, { active: true, schedule: cron.schedule })))
  assert.ok(cronBack.ok && cronBack.activation.every === '*/10 * * * *')
  const weeklyMd = withActivation(BRIEF_MD, { active: true, schedule: { kind: 'weekly', hour: 9, minute: 0, weekday: 5 }, on: { context: ['people/**'], webhook: null } })
  const weeklyBack = parseAgentActivation(parseFrontmatter(weeklyMd))
  assert.ok(weeklyBack.ok && weeklyBack.activation.schedule?.kind === 'weekly' && weeklyBack.activation.schedule.weekday === 5 && weeklyBack.activation.on?.context[0] === 'people/**', weeklyMd)
  assert.equal(describeTriggers(base.activation.on), 'when people/** changes · webhook hubspot')
  assert.equal(describeSchedule({ kind: 'interval', minutes: 15 }, null), 'Every 15 minutes')
})
