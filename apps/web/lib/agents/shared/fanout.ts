/**
 * Who a fire is for, and when the next one is. Pure.
 *
 * An agent has one clock row, and several people it runs for — some at the
 * agent's own time, some at theirs (`for:` entries with `at` / `timezone`,
 * lib/agents/shared/runsFor.ts). So the row's `next_run_at` is the EARLIEST of
 * everyone's next occurrence, and a fire runs only the people whose own
 * occurrence has come round since the last one. A fire woken by events rather
 * than the clock is for everyone.
 *
 * A person's own time only means something on a daily or weekly agent; on any
 * other clock they ride the agent's. A person whose model is their own plan
 * (`local/*`) is never fired: the server cannot call it, so their runs start
 * from the desktop app when they press Run.
 */
import { nextOccurrence, type AgentSchedule } from '../config'
import type { RunsForEntry } from './runsFor'

/** The clock one person's runs keep: the agent's, at their time and in their zone. */
export function clockFor(schedule: AgentSchedule, tz: string, entry: RunsForEntry | null): { schedule: AgentSchedule; tz: string } {
  if (!entry || (schedule.kind !== 'daily' && schedule.kind !== 'weekly')) return { schedule, tz }
  return {
    schedule: entry.at ? { ...schedule, hour: entry.at.hour, minute: entry.at.minute } : schedule,
    tz: entry.timezone ?? tz,
  }
}

/** The people a fire can run for at all. */
const fireable = (runsFor: RunsForEntry[]) => runsFor.filter((e) => !e.model?.toLowerCase().startsWith('local/'))

const ownClock = (schedule: AgentSchedule, entry: RunsForEntry) =>
  (schedule.kind === 'daily' || schedule.kind === 'weekly') && (entry.at !== null || entry.timezone !== null)

/** The earliest next occurrence across the agent's clock and everyone's own. */
export function nextFire(schedule: AgentSchedule, tz: string, runsFor: RunsForEntry[], after: Date): Date {
  let next = nextOccurrence(schedule, after, tz)
  for (const entry of fireable(runsFor)) {
    if (!ownClock(schedule, entry)) continue
    const own = clockFor(schedule, tz, entry)
    const at = nextOccurrence(own.schedule, after, own.tz)
    if (at < next) next = at
  }
  return next
}

/**
 * The identities this fire runs as, in order: `null` is the agent's own (its
 * author, or `runs_as`), then each person. `authorId` is dropped from the
 * people — the agent's own run already is theirs.
 */
export function dueIdentities(input: {
  schedule: AgentSchedule | null
  tz: string
  runsFor: RunsForEntry[]
  authorId: string | null
  lastRunAt: Date | null
  now: Date
  /** Events woke this fire: it is for everyone, whatever the clock says. */
  woken: boolean
}): (string | null)[] {
  const { schedule, tz, authorId, now, woken } = input
  const people = fireable(input.runsFor).filter((e) => e.userId !== authorId)
  if (woken || !schedule) return [null, ...people.map((e) => e.userId)]
  const since = input.lastRunAt ?? new Date(0)
  const due = (s: AgentSchedule, zone: string) => nextOccurrence(s, since, zone) <= now
  const agentDue = due(schedule, tz)
  const out: (string | null)[] = agentDue ? [null] : []
  for (const entry of people) {
    if (!ownClock(schedule, entry)) {
      if (agentDue) out.push(entry.userId)
      continue
    }
    const own = clockFor(schedule, tz, entry)
    if (due(own.schedule, own.tz)) out.push(entry.userId)
  }
  return out
}
