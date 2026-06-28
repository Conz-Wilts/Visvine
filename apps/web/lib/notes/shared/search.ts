// Pure full-text search over note bodies. No fs/DOM access — usable from the
// main process, the renderer, and tests alike. The Quick switcher already covers
// title+path matching; this ranks notes by how well their *body* content matches
// a query, and is the local precursor to the knowledge's retrieval layer
// (§4 `search_knowledge`). The caller supplies the already-extracted body
// (e.g. via `splitFrontmatter`), keeping this module free of markdown concerns.

export interface SearchDoc {
  path: string
  title: string
  body: string
}

export interface SearchResult {
  path: string
  title: string
  score: number
  snippet: string
}

// A title hit counts for more than a body hit when ranking.
const TITLE_WEIGHT = 5
// Snippet window: characters of context before the first match, and total length.
const SNIPPET_BEFORE = 30
const SNIPPET_LEN = 90

// Lowercased, whitespace-delimited query terms; empty terms dropped.
function terms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

// Count non-overlapping occurrences of `needle` in `haystack` (both lowercased
// by the caller).
function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0
  let count = 0
  let i = haystack.indexOf(needle)
  while (i !== -1) {
    count++
    i = haystack.indexOf(needle, i + needle.length)
  }
  return count
}

// A one-line excerpt around the earliest body match of any term. Falls back to
// the body's opening when the query matched only in the title. Internal
// whitespace is collapsed so multi-line notes render as a tidy single line.
function makeSnippet(body: string, lowerBody: string, qterms: string[]): string {
  let pos = -1
  for (const t of qterms) {
    const i = lowerBody.indexOf(t)
    if (i !== -1 && (pos === -1 || i < pos)) pos = i
  }
  const start = pos === -1 ? 0 : Math.max(0, pos - SNIPPET_BEFORE)
  const end = Math.min(body.length, start + SNIPPET_LEN)
  let s = body.slice(start, end).replace(/\s+/g, ' ').trim()
  if (start > 0) s = '…' + s
  if (end < body.length) s = s + '…'
  return s
}

// Rank notes whose title or body contains ALL query terms (AND semantics).
// Score sums per-term hits with a title boost; ties break alphabetically by
// title. Returns [] for an empty query.
export function searchNotes(docs: SearchDoc[], query: string): SearchResult[] {
  const qterms = terms(query)
  if (qterms.length === 0) return []

  const results: SearchResult[] = []
  for (const doc of docs) {
    const lowerTitle = doc.title.toLowerCase()
    const lowerBody = doc.body.toLowerCase()
    let score = 0
    let allPresent = true
    for (const t of qterms) {
      const titleHits = countOccurrences(lowerTitle, t)
      const bodyHits = countOccurrences(lowerBody, t)
      if (titleHits === 0 && bodyHits === 0) {
        allPresent = false
        break
      }
      score += titleHits * TITLE_WEIGHT + bodyHits
    }
    if (!allPresent) continue
    results.push({
      path: doc.path,
      title: doc.title,
      score,
      snippet: makeSnippet(doc.body, lowerBody, qterms),
    })
  }

  results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
  return results
}
