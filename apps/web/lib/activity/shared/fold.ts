/**
 * One list from several sources. Pure.
 *
 * Every source hands over its rows newest first, already cut at the cursor;
 * the fold merges them by `(at desc, id desc)`, drops a row seen twice, and
 * cuts the page. The cursor is the last row's `at|id`, the same keyset shape
 * the feed and a chat thread use, so a page is stable while new rows arrive.
 */
import type { ActivityRow } from './rows'

const ACTIVITY_PAGE_SIZE = 30
export const ACTIVITY_PAGE_MAX = 50
/** How far back a source looks. Older than this is history, not activity. */
export const ACTIVITY_WINDOW_DAYS = 30
/** Upcoming events shown on the first page. */
const ACTIVITY_UPCOMING_MAX = 10

export interface ActivityCursor {
  at: Date
  id: string
}

export function encodeActivityCursor(row: { at: string; id: string }): string {
  return `${row.at}|${row.id}`
}

export function decodeActivityCursor(raw: string | null | undefined): ActivityCursor | null {
  if (!raw) return null
  const split = raw.indexOf('|')
  if (split <= 0 || split === raw.length - 1) return null
  const at = new Date(raw.slice(0, split))
  if (Number.isNaN(at.getTime())) return null
  return { at, id: raw.slice(split + 1) }
}

function later(a: ActivityRow, b: ActivityRow): number {
  const ta = Date.parse(a.at)
  const tb = Date.parse(b.at)
  if (ta !== tb) return tb - ta
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

/** Is `row` strictly before the cursor in `(at desc, id desc)` order? */
function beforeCursor(row: ActivityRow, cursor: ActivityCursor): boolean {
  const t = Date.parse(row.at)
  const c = cursor.at.getTime()
  return t < c || (t === c && row.id < cursor.id)
}

export function foldActivity(
  sources: readonly (readonly ActivityRow[])[],
  opts: { cursor?: ActivityCursor | null; limit?: number } = {},
): { items: ActivityRow[]; nextCursor: string | null } {
  const limit = Math.min(Math.max(opts.limit ?? ACTIVITY_PAGE_SIZE, 1), ACTIVITY_PAGE_MAX)
  const seen = new Set<string>()
  const all: ActivityRow[] = []
  for (const source of sources) {
    for (const row of source) {
      if (seen.has(row.id)) continue
      if (opts.cursor && !beforeCursor(row, opts.cursor)) continue
      seen.add(row.id)
      all.push(row)
    }
  }
  all.sort(later)
  const items = all.slice(0, limit)
  const last = items[items.length - 1]
  return { items, nextCursor: all.length > limit && last ? encodeActivityCursor(last) : null }
}

/** The next events, soonest first, from now. */
export function upcomingOf(events: readonly ActivityRow[], now: Date, max = ACTIVITY_UPCOMING_MAX): ActivityRow[] {
  return events
    .filter((e) => Date.parse(e.at) >= now.getTime())
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(0, max)
}
