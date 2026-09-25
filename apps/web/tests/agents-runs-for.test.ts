import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { modelFor, parseRunsFor, runsForDenial, runsForFrontmatter, withRunsFor, type RunsForEntry } from '../lib/agents/shared/runsFor'
import { clockFor, dueIdentities, nextFire } from '../lib/agents/shared/fanout'
import { applyConfigPatch, defaultAgentConfig, effectiveFrontmatter } from '../lib/agents/shared/agentConfig'
import { parseAgentBrief, type AgentSchedule } from '../lib/agents/config'
import { parseFrontmatter, splitFrontmatter } from '../lib/notes/shared/markdown'

const entry = (userId: string, over: Partial<RunsForEntry> = {}): RunsForEntry => ({ userId, at: null, timezone: null, model: null, inputs: {}, ...over })
const daily: AgentSchedule = { kind: 'daily', hour: 7, minute: 0 }
const utc = (iso: string) => new Date(`${iso}Z`)

describe('parseRunsFor', () => {
  it('reads people with and without their own settings', () => {
    const r = parseRunsFor([{ user: 'u1' }, { user: 'u2', at: '07:30', timezone: 'Pacific/Auckland', model: 'local/claude' }, 'u3'])
    assert.ok(r.ok)
    assert.deepEqual(r.entries, [entry('u1'), entry('u2', { at: { hour: 7, minute: 30 }, timezone: 'Pacific/Auckland', model: 'local/claude' }), entry('u3')])
    assert.deepEqual(runsForFrontmatter(r.entries)?.[1], { user: 'u2', at: '07:30', timezone: 'Pacific/Auckland', model: 'local/claude' })
  })

  it('refuses a bad time, a bad zone, a duplicate and a crowd', () => {
    assert.equal(parseRunsFor([{ user: 'u1', at: '25:00' }]).ok, false)
    assert.equal(parseRunsFor([{ user: 'u1', timezone: 'Mars/Base' }]).ok, false)
    assert.equal(parseRunsFor([{ user: 'u1' }, { user: 'u1' }]).ok, false)
    assert.equal(parseRunsFor(Array.from({ length: 11 }, (_, i) => ({ user: `u${i}` }))).ok, false)
    assert.deepEqual(parseRunsFor(undefined), { ok: true, entries: [] })
  })
})

describe('runsForDenial', () => {
  const member = { userId: 'me', isAdmin: false }
  it('lets a person add, change and remove themselves, and remove anyone', () => {
    assert.equal(runsForDenial([], [entry('me')], member), null)
    assert.equal(runsForDenial([entry('me')], [entry('me', { model: 'local/claude' })], member), null)
    assert.equal(runsForDenial([entry('me'), entry('ana')], [], member), null)
    assert.equal(runsForDenial([entry('ana')], [entry('ana'), entry('me')], member), null)
  })
  it('refuses adding or changing somebody else, unless an admin does it', () => {
    assert.ok(runsForDenial([], [entry('ana')], member))
    assert.ok(runsForDenial([entry('ana')], [entry('ana', { at: { hour: 3, minute: 0 } })], member))
    assert.equal(runsForDenial([], [entry('ana')], { userId: 'boss', isAdmin: true }), null)
  })
})

describe('the brief', () => {
  const note = '---\ntype: agent\ntitle: Digest\n---\n\nSummarise.\n'
  it('carries one person in and out of the record without touching the rest', () => {
    const withMe = applyConfigPatch(defaultAgentConfig(), { runsFor: withRunsFor([], 'me', { at: { hour: 8, minute: 5 }, timezone: null, model: null, inputs: {} }) })
    assert.ok(withMe.ok)
    if (!withMe.ok) return
    const parsed = parseAgentBrief(effectiveFrontmatter(parseFrontmatter(note), withMe.config), splitFrontmatter(note).body)
    assert.ok(parsed.ok)
    assert.deepEqual(parsed.brief.runsFor, [entry('me', { at: { hour: 8, minute: 5 } })])
    assert.equal(parsed.brief.title, 'Digest')
    assert.deepEqual(withRunsFor(withMe.config.runsFor, 'me', null), [])
    assert.deepEqual(withRunsFor([entry('a'), entry('b')], 'a', { at: null, timezone: null, model: 'x/y', inputs: {} }).map((e) => e.userId), ['a', 'b'])
  })
  it('gives a person their own model, everyone else the brief’s', () => {
    const brief = { model: 'openai/gpt', runsFor: [entry('ana', { model: 'local/claude' }), entry('bo')] }
    assert.equal(modelFor(brief, 'ana'), 'local/claude')
    assert.equal(modelFor(brief, 'bo'), 'openai/gpt')
    assert.equal(modelFor(brief, null), 'openai/gpt')
  })
})

describe('fan-out', () => {
  const ana = entry('ana', { at: { hour: 7, minute: 30 } })
  const kai = entry('kai', { timezone: 'Pacific/Auckland' })
  const bo = entry('bo')

  it('fires at the earliest of everyone’s next time', () => {
    assert.deepEqual(nextFire(daily, 'UTC', [ana, bo], utc('2026-09-19T07:10:00')), utc('2026-09-19T07:30:00'))
    assert.deepEqual(nextFire(daily, 'UTC', [bo], utc('2026-09-19T07:10:00')), utc('2026-09-20T07:00:00'))
    assert.deepEqual(clockFor({ kind: 'interval', minutes: 15 }, 'UTC', ana).schedule, { kind: 'interval', minutes: 15 })
  })

  it('runs only the people whose time has come', () => {
    const base = { schedule: daily, tz: 'UTC', runsFor: [ana, bo, kai], authorId: 'author', woken: false }
    assert.deepEqual(dueIdentities({ ...base, lastRunAt: utc('2026-09-18T19:00:00'), now: utc('2026-09-19T07:00:30') }), [null, 'bo'])
    assert.deepEqual(dueIdentities({ ...base, lastRunAt: utc('2026-09-19T07:00:30'), now: utc('2026-09-19T07:30:30') }), ['ana'])
    // 07:00 in Auckland is 19:00 UTC the day before.
    assert.deepEqual(dueIdentities({ ...base, lastRunAt: utc('2026-09-19T07:30:30'), now: utc('2026-09-19T19:00:30') }), ['kai'])
  })

  it('is for everyone when events woke it, never for a person on their own plan, never twice for the author', () => {
    const local = entry('lo', { model: 'local/claude' })
    const who = dueIdentities({ schedule: daily, tz: 'UTC', runsFor: [ana, local, entry('author')], authorId: 'author', lastRunAt: null, now: utc('2026-09-19T03:00:00'), woken: true })
    assert.deepEqual(who, [null, 'ana'])
  })

})
