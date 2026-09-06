/**
 * The roster's two shapes, pure: agents filed under their groups, and the
 * next stretch of the clock across all of them.
 *
 * A group is the brief's first tag — `tags: [Investments]` — because a space
 * already groups everything else by tag and a second vocabulary for agents
 * would be one more thing to keep in step. Ungrouped agents file last, under
 * no heading when they are the only ones. The clock is one list ordered by
 * time: what is running now first, then every fire due inside the window,
 * the nightly clean among them, since it is a scheduled pass that runs as a
 * person and writes a run row like any other.
 *
 * tests/agents-roster.test.ts
 */

export interface RosterAgent {
  name: string
  title: string
  tags: string[]
  status: 'idle' | 'running'
  active: boolean
  nextRunAt: string | null
  runsFor: { names: string[]; count: number }
}

export interface RosterGroup<T extends RosterAgent> {
  /** Null for the agents no tag files. */
  name: string | null
  agents: T[]
}

/** File agents under their first tag; groups in order of first appearance, ungrouped last. */
export function groupAgents<T extends RosterAgent>(agents: readonly T[]): RosterGroup<T>[] {
  const groups = new Map<string | null, T[]>()
  for (const a of agents) {
    const key = a.tags[0]?.trim() || null
    const list = groups.get(key) ?? []
    list.push(a)
    groups.set(key, list)
  }
  const named = [...groups.entries()].filter(([k]) => k !== null).sort((a, b) => a[0]!.localeCompare(b[0]!))
  const rest = groups.get(null)
  return [...named.map(([name, list]) => ({ name, agents: list })), ...(rest ? [{ name: null, agents: rest }] : [])]
}

export interface ClockEntry {
  /** The agent's name, or `clean` for the nightly clean. */
  name: string
  title: string
  at: string | null
  kind: 'running' | 'due' | 'clean'
  /** Who it runs for, "Craig +3". */
  who: string | null
}

const CLOCK_WINDOW_MS = 24 * 60 * 60 * 1000

export function whoLabel(runsFor: { names: string[]; count: number }): string | null {
  if (runsFor.count === 0) return null
  const shown = runsFor.names.slice(0, 1)
  const more = runsFor.count - shown.length
  if (shown.length === 0) return `${runsFor.count}`
  return more > 0 ? `${shown[0]} +${more}` : shown[0]
}

/**
 * The next 24 hours: running now (in the order they started is unknown here,
 * so by name), then everything due inside the window by time. Off agents and
 * trigger-only agents with nothing due are not on the clock.
 */
export function clockEntries(
  agents: readonly RosterAgent[],
  clean: { enabled: boolean; nextRunAt: string | null; runAsName: string | null } | null,
  now: number,
): ClockEntry[] {
  const running: ClockEntry[] = agents
    .filter((a) => a.status === 'running')
    .map((a) => ({ name: a.name, title: a.title, at: null, kind: 'running' as const, who: whoLabel(a.runsFor) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const due: ClockEntry[] = agents
    .filter((a) => a.status !== 'running' && a.active && a.nextRunAt && new Date(a.nextRunAt).getTime() - now <= CLOCK_WINDOW_MS)
    .map((a) => ({ name: a.name, title: a.title, at: a.nextRunAt, kind: 'due' as const, who: whoLabel(a.runsFor) }))
  if (clean?.enabled && clean.nextRunAt && new Date(clean.nextRunAt).getTime() - now <= CLOCK_WINDOW_MS) {
    due.push({ name: 'clean', title: 'Clean', at: clean.nextRunAt, kind: 'clean', who: clean.runAsName })
  }
  due.sort((a, b) => new Date(a.at!).getTime() - new Date(b.at!).getTime())
  return [...running, ...due]
}
