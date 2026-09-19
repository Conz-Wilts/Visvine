/**
 * Who an agent runs for — the brief's `for:` block. Pure.
 *
 *   for:
 *     - user: <userId>              rides the agent's own time and model
 *     - user: <userId>
 *       at: "07:30"
 *       timezone: Pacific/Auckland
 *       model: local/claude
 *
 * An entry is a PRINCIPAL: each fire runs once more under that person's
 * standing, so a `mode: user` connector spends their account. That is why an
 * entry is the person's own to add. Anyone who can edit the brief may take one
 * out; only the person — or a space admin — may put one in or change it
 * (`runsForDenial`, asked by the write gate beside `runs_as`).
 */
import { MAX_FANOUT_SUBSCRIBERS } from '../limits'

export interface RunsForEntry {
  userId: string
  /** Their own time of day, for a daily or weekly agent. */
  at: { hour: number; minute: number } | null
  /** Their own IANA zone; null rides the agent's. */
  timezone: string | null
  /** The model their runs use, as written; null rides the brief's. */
  model: string | null
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/
const USER_ID_RE = /^[A-Za-z0-9_:-]{1,80}$/

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function parseRunsFor(raw: unknown): { ok: true; entries: RunsForEntry[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, entries: [] }
  if (!Array.isArray(raw)) return { ok: false, error: '`for` must be a list of people' }
  if (raw.length > MAX_FANOUT_SUBSCRIBERS) return { ok: false, error: `\`for\` holds at most ${MAX_FANOUT_SUBSCRIBERS} people` }
  const entries: RunsForEntry[] = []
  for (const item of raw) {
    const row: Record<string, unknown> = typeof item === 'string' ? { user: item } : item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const userId = typeof row.user === 'string' ? row.user.trim() : ''
    if (!USER_ID_RE.test(userId)) return { ok: false, error: 'every `for` entry names a `user`' }
    if (entries.some((e) => e.userId === userId)) return { ok: false, error: `\`for\` names ${userId} twice` }
    let at: RunsForEntry['at'] = null
    if (row.at !== undefined && row.at !== null && row.at !== '') {
      const m = TIME_RE.exec(String(row.at).trim())
      if (!m) return { ok: false, error: `\`at\` for ${userId} must be HH:MM` }
      at = { hour: Number(m[1]), minute: Number(m[2]) }
    }
    let timezone: string | null = null
    if (typeof row.timezone === 'string' && row.timezone.trim()) {
      timezone = row.timezone.trim()
      if (!validTimeZone(timezone)) return { ok: false, error: `"${timezone}" is not a time zone` }
    }
    const model = typeof row.model === 'string' && row.model.trim() ? row.model.trim() : null
    entries.push({ userId, at, timezone, model })
  }
  return { ok: true, entries }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** The block as frontmatter writes it; undefined when nobody is listed. */
export function runsForFrontmatter(entries: RunsForEntry[]): Record<string, string>[] | undefined {
  if (entries.length === 0) return undefined
  return entries.map((e) => ({
    user: e.userId,
    ...(e.at ? { at: `${pad(e.at.hour)}:${pad(e.at.minute)}` } : {}),
    ...(e.timezone ? { timezone: e.timezone } : {}),
    ...(e.model ? { model: e.model } : {}),
  }))
}

/** `entries` with one person's entry set (or, with null, removed); the rest untouched. */
export function withRunsFor(entries: RunsForEntry[], userId: string, entry: Omit<RunsForEntry, 'userId'> | null): RunsForEntry[] {
  const rest = entries.filter((e) => e.userId !== userId)
  if (!entry) return rest
  const index = entries.findIndex((e) => e.userId === userId)
  const next = { userId, ...entry }
  return index < 0 ? [...rest, next] : [...entries.slice(0, index), next, ...entries.slice(index + 1)]
}

const same = (a: RunsForEntry, b: RunsForEntry) =>
  a.at?.hour === b.at?.hour && a.at?.minute === b.at?.minute && a.timezone === b.timezone && a.model === b.model

/**
 * Why `writer` may not turn `before` into `after`, or null. Removing anyone is
 * an edit like any other; adding or changing an entry is that person's own act,
 * or a space admin's.
 */
export function runsForDenial(before: RunsForEntry[], after: RunsForEntry[], writer: { userId: string; isAdmin: boolean }): string | null {
  if (writer.isAdmin) return null
  for (const entry of after) {
    if (entry.userId === writer.userId) continue
    const was = before.find((e) => e.userId === entry.userId)
    if (!was || !same(was, entry)) return 'An agent runs for a person only when they add themselves — share the agent with them instead.'
  }
  return null
}

/** The model a run for `userId` uses: their own, else the brief's. */
export function modelFor(brief: { model: string | null; runsFor: RunsForEntry[] }, userId: string | null): string | null {
  return (userId ? brief.runsFor.find((e) => e.userId === userId)?.model : null) ?? brief.model
}
