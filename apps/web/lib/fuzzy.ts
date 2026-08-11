// The one match-scorer the app's type-to-filter surfaces share, so a query
// ranks the same way in the note switcher and the type picker.

/**
 * How well `text` answers `query`, highest first: a prefix beats a substring
 * beats a subsequence, and 0 means no match at all. An empty query matches
 * everything (score 1), which is what keeps an unfiltered list in its own,
 * meaningful order rather than an arbitrary scored one.
 */
export function scoreText(text: string, query: string): number {
  if (!query) return 1
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (t.startsWith(q)) return 100
  if (t.includes(q)) return 60
  let i = 0
  for (const ch of t) if (ch === q[i]) i++
  return i === q.length ? 10 : 0
}
