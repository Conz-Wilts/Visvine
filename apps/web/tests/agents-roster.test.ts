import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clockEntries, groupAgents, whoLabel, type RosterAgent } from '../lib/agents/shared/roster'

const a = (over: Partial<RosterAgent> & { name: string }): RosterAgent => ({
  title: over.name,
  tags: [],
  status: 'idle',
  active: true,
  nextRunAt: null,
  runsFor: { names: [], count: 0 },
  ...over,
})

test('agents file under their first tag, sorted, ungrouped last', () => {
  const groups = groupAgents([
    a({ name: 'ops-1', tags: ['Operations'] }),
    a({ name: 'loose' }),
    a({ name: 'inv-1', tags: ['Investments', 'weekly'] }),
    a({ name: 'inv-2', tags: ['Investments'] }),
  ])
  assert.deepEqual(
    groups.map((g) => [g.name, g.agents.map((x) => x.name)]),
    [
      ['Investments', ['inv-1', 'inv-2']],
      ['Operations', ['ops-1']],
      [null, ['loose']],
    ],
  )
})

test('the clock: running first, then due inside 24h by time, clean among them', () => {
  const now = Date.parse('2026-09-06T12:00:00Z')
  const iso = (h: number) => new Date(now + h * 3_600_000).toISOString()
  const entries = clockEntries(
    [
      a({ name: 'late', nextRunAt: iso(30) }),
      a({ name: 'soon', nextRunAt: iso(2), runsFor: { names: ['Craig'], count: 4 } }),
      a({ name: 'busy', status: 'running', nextRunAt: iso(1) }),
      a({ name: 'off', active: false, nextRunAt: iso(1) }),
      a({ name: 'trigger-only' }),
    ],
    { enabled: true, nextRunAt: iso(15), runAsName: 'Connor' },
    now,
  )
  assert.deepEqual(
    entries.map((e) => [e.name, e.kind, e.who]),
    [
      ['busy', 'running', null],
      ['soon', 'due', 'Craig +3'],
      ['clean', 'clean', 'Connor'],
    ],
  )
})

test('who reads as one name and a count', () => {
  assert.equal(whoLabel({ names: [], count: 0 }), null)
  assert.equal(whoLabel({ names: ['Craig'], count: 1 }), 'Craig')
  assert.equal(whoLabel({ names: ['Craig', 'Ana'], count: 3 }), 'Craig +2')
})
