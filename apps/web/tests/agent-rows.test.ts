/**
 * switchOnBody (features/agents/lib/agentRows.ts): turning an agent back on
 * from the table keeps the schedule and triggers it already has.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/agent-rows.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { switchOnBody } from '@/features/agents/lib/agentRows'
import type { AgentSummary } from '@/lib/agents/service'

const base: AgentSummary['activation'] = {
  active: false, schedule: null, scheduleLabel: 'No schedule', every: null, on: null, triggersLabel: null, debounceMs: 60_000, timezone: 'Pacific/Auckland', invalid: null,
}

test('each clock and the triggers go back as the switch reads them', () => {
  assert.equal(switchOnBody(base), null, 'nothing to run on: choose when first')
  assert.deepEqual(switchOnBody({ ...base, schedule: { kind: 'weekly', hour: 9, minute: 5, weekday: 1 } }), {
    active: true, schedule: 'weekly', at: '09:05', on: 'monday', debounce: '60s', timezone: 'Pacific/Auckland',
  })
  assert.equal(switchOnBody({ ...base, schedule: { kind: 'interval', minutes: 15 }, every: '15m' })?.every, '15m')
  const triggered = switchOnBody({ ...base, on: { context: ['inbox/**'], webhook: null }, debounceMs: 5_000 })
  assert.deepEqual(triggered?.triggers, { context: ['inbox/**'], webhook: null })
  assert.equal(triggered?.debounce, '5s')
})
