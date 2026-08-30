/**
 * Turning an agent on, and the line that keeps authoring separate from it.
 *
 * Two things are under test, and they are the two halves of the same rule:
 *
 *  1. `parseScheduleFields` — the schedule both doors read. It was one private
 *     function inside the PATCH route until `activate_agent` needed the same
 *     answer; if the two ever disagreed, an agent would run at a different time
 *     depending on which door turned it on.
 *
 *  2. `lockedDenial` — that `agents/` is still shut to autonomous origins. The
 *     `create_agent` action writes a brief at a HUMAN origin, exactly as the
 *     Tool authoring loop does for `tools/`, and the whole safety of that
 *     carve-out is that the generic AI write is still refused. A regression
 *     here would let a maintenance sweep reformat every brief in a space and
 *     silently switch them all off (lib/agents/hooks deactivates on edit).
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/agents-activation.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseScheduleFields } from '@/lib/agents/config'
import { lockedDenial } from '@/lib/notes/contextService'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import { OPEN_ACCESS } from '@/lib/notes/shared/authz'

const SHARED = { spaceId: 'space_1', ownerKey: 'shared' }

const principal = (): ContextPrincipal => ({
  userId: 'user_1',
  email: 'a@local.dev',
  name: 'A',
  spaceId: 'space_1',
  spaceAdmin: true,
  access: { ...OPEN_ACCESS, locked: [] },
})

test('a clock schedule needs its time, and a weekly one needs its day', () => {
  assert.deepEqual(parseScheduleFields({ schedule: 'hourly' }), { ok: true, schedule: { kind: 'hourly' } })
  assert.deepEqual(parseScheduleFields({ schedule: 'daily', at: '07:00' }), {
    ok: true,
    schedule: { kind: 'daily', hour: 7, minute: 0 },
  })
  assert.deepEqual(parseScheduleFields({ schedule: 'weekly', at: '09:30', weekday: 'monday' }), {
    ok: true,
    schedule: { kind: 'weekly', hour: 9, minute: 30, weekday: 1 },
  })

  const noTime = parseScheduleFields({ schedule: 'daily' })
  assert.equal(noTime.ok, false)
  const noDay = parseScheduleFields({ schedule: 'weekly', at: '09:30' })
  assert.equal(noDay.ok, false)
  const nonsense = parseScheduleFields({ schedule: 'fortnightly' })
  assert.equal(nonsense.ok, false)
})

test('an interval or a cron is the other way to say when, and never both', () => {
  const fifteen = parseScheduleFields({ every: '15m' })
  assert.ok(fifteen.ok && fifteen.schedule?.kind === 'interval')
  const cron = parseScheduleFields({ every: '0 9 * * 1' })
  assert.ok(cron.ok && cron.schedule?.kind === 'cron')

  const both = parseScheduleFields({ schedule: 'daily', at: '07:00', every: '15m' })
  assert.equal(both.ok, false)
  assert.match(both.ok ? '' : both.error, /exclusive/)

  // The floor is the tick's own cadence — once a minute, however it is spelled.
  assert.ok(parseScheduleFields({ every: '1m' }).ok)
  assert.ok(parseScheduleFields({ every: '* * * * *' }).ok)
  assert.equal(parseScheduleFields({ every: '0m' }).ok, false)
})

test('no schedule at all is a trigger-only agent, not an error', () => {
  // activateAgent is the one place that insists on schedule-or-trigger, so the
  // parser must not pre-empt it: an agent that only runs on `on_context` has
  // nothing to say here.
  assert.deepEqual(parseScheduleFields({}), { ok: true, schedule: null })
  assert.deepEqual(parseScheduleFields({ schedule: 'none' }), { ok: true, schedule: null })
})

test('agents/ stays shut to autonomous origins — that is what makes the create carve-out safe', () => {
  const p = principal()
  for (const origin of ['agent', 'ai-enrich', 'maintenance'] as const) {
    assert.match(
      lockedDenial(p, SHARED, 'agents/weekly-digest/index.md', origin) ?? '',
      /frozen for AI/,
      `origin ${origin} must not reach a brief`,
    )
    assert.match(lockedDenial(p, SHARED, 'agents/weekly-digest/activation.md', origin) ?? '', /frozen for AI/)
  }
  // createAgentBrief writes at the default human origin. If that ever stopped
  // being allowed the action would be dead; if the line above ever stopped
  // being refused, the freeze would be decorative.
  assert.equal(lockedDenial(p, SHARED, 'agents/weekly-digest/index.md', 'edit'), null)
})
