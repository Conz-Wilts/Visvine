// Pure relative-time formatting. No Date.now()/DOM/fs — the caller supplies the
// reference time, so this stays deterministic and testable. Surfacing each note's
// last-modified time is the local precursor to §4's "freshness is first-class ·
// provenance on every row" principle.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`
}

// Format `then` (epoch ms) relative to `now` (epoch ms), e.g. "just now",
// "5 minutes ago", "3 days ago". Future timestamps (clock skew) read "just now".
export function formatRelativeTime(then: number, now: number): string {
  const diff = now - then
  if (diff < MINUTE) return 'just now'
  if (diff < HOUR) return plural(Math.floor(diff / MINUTE), 'minute')
  if (diff < DAY) return plural(Math.floor(diff / HOUR), 'hour')
  if (diff < WEEK) return plural(Math.floor(diff / DAY), 'day')
  if (diff < MONTH) return plural(Math.floor(diff / WEEK), 'week')
  if (diff < YEAR) return plural(Math.floor(diff / MONTH), 'month')
  return plural(Math.floor(diff / YEAR), 'year')
}
