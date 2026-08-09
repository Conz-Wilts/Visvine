// Pure BM25 full-text ranking over note bodies, ported from blackbird-brain's
// src/shared/search.ts. Field boosts (title 3×, tags/aliases 2×), light plural
// stemming, and AND semantics that relax to OR when the strict pass matches
// nothing. This is the text stage of the fused retrieval stack (./retrieval.ts);
// the simpler ./search.ts remains for the client-side quick search.

export interface Bm25Doc {
  path: string
  title: string
  body: string
  tags?: string[]
  aliases?: string[]
}

export interface Bm25Result {
  path: string
  title: string
  score: number
  snippet: string
}

// Standard BM25 constants; field boosts fold title/tag hits into one weighted tf.
const K1 = 1.2
const B = 0.75
const TITLE_BOOST = 3
const TAG_BOOST = 2
const SNIPPET_BEFORE = 30
const SNIPPET_LENGTH = 260
const MAX_POSITIONS_PER_TERM = 20

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Light plural stemming — enough that meeting/meetings and company/companies
 * match, without a full stemmer's surprises. Every stem is a prefix of (or maps
 * predictably from) the original word, so snippets still highlight sensibly.
 */
function stem(t: string): string {
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y'
  if (
    t.length > 3 &&
    t.endsWith('es') &&
    (t.endsWith('shes') || t.endsWith('ches') || t.endsWith('xes') || t.endsWith('zes'))
  ) {
    return t.slice(0, -2)
  }
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us') && !t.endsWith('is')) {
    return t.slice(0, -1)
  }
  return t
}

/** Lowercased, stemmed alphanumeric tokens, length ≥ 2. No stopword list — IDF handles it. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2)
    .map(stem)
}

/** An excerpt around the densest cluster of distinct query terms in the body. */
function makeSnippet(body: string, qterms: string[]): string {
  const lower = body.toLowerCase()
  const positions: Array<{ pos: number; term: string }> = []
  for (const term of qterms) {
    let from = 0
    for (let i = 0; i < MAX_POSITIONS_PER_TERM; i++) {
      const found = lower.indexOf(term, from)
      if (found === -1) break
      positions.push({ pos: found, term })
      from = found + term.length
    }
  }

  // Title/tag-only hit — lead with the top of the body.
  if (positions.length === 0) {
    const end = Math.min(body.length, SNIPPET_LENGTH)
    let snippet = collapseWhitespace(body.slice(0, end))
    if (end < body.length) snippet += '…'
    return snippet
  }

  // Pick the window covering the most distinct terms; ties go to the earliest.
  positions.sort((a, b) => a.pos - b.pos)
  let bestPos = positions[0].pos
  let bestCount = 0
  for (let i = 0; i < positions.length; i++) {
    const windowStart = positions[i].pos
    const seen = new Set<string>()
    for (let j = i; j < positions.length && positions[j].pos < windowStart + SNIPPET_LENGTH; j++) {
      seen.add(positions[j].term)
    }
    if (seen.size > bestCount) {
      bestCount = seen.size
      bestPos = windowStart
    }
  }

  const start = Math.max(0, bestPos - SNIPPET_BEFORE)
  const end = Math.min(body.length, start + SNIPPET_LENGTH)
  let snippet = collapseWhitespace(body.slice(start, end))
  if (start > 0) snippet = '…' + snippet
  if (end < body.length) snippet += '…'
  return snippet
}

/**
 * An excerpt of `body` around the query's terms — the same window BM25 hits get,
 * exposed for candidates that reach the results through another stage (vector,
 * link context) and so never passed through `rank`.
 */
export function snippetFor(body: string, query: string): string {
  return makeSnippet(body, [...new Set(tokenize(query))])
}

/**
 * Rank notes containing ALL query tokens in some field (AND semantics) by BM25
 * over a field-boosted term frequency (body + 3×title + 2×tags/aliases), with body
 * length normalization. When the strict AND pass matches nothing, the search
 * automatically retries with OR semantics (any token matches). Ties break
 * alphabetically. Returns [] for an empty query.
 */
export function bm25Search(docs: Bm25Doc[], query: string): Bm25Result[] {
  const and = rank(docs, query, 'and')
  if (and.length > 0) return and
  return rank(docs, query, 'any')
}

function rank(docs: Bm25Doc[], query: string, mode: 'and' | 'any'): Bm25Result[] {
  const qterms = [...new Set(tokenize(query))]
  if (qterms.length === 0) return []
  const qset = new Set(qterms)

  // Weighted per-doc frequency of each query term, plus body length for normalization.
  const prepared = docs.map((doc) => {
    const bodyTokens = tokenize(doc.body)
    const fields: Array<{ tokens: string[]; weight: number }> = [
      { tokens: bodyTokens, weight: 1 },
      { tokens: tokenize(doc.title), weight: TITLE_BOOST },
      { tokens: tokenize([...(doc.tags ?? []), ...(doc.aliases ?? [])].join(' ')), weight: TAG_BOOST },
    ]
    const tf = new Map<string, number>()
    for (const { tokens, weight } of fields) {
      for (const t of tokens) {
        if (qset.has(t)) tf.set(t, (tf.get(t) ?? 0) + weight)
      }
    }
    return { doc, tf, len: bodyTokens.length }
  })

  const N = docs.length
  const df = new Map(qterms.map((t) => [t, prepared.filter((p) => p.tf.has(t)).length]))
  const totalLen = prepared.reduce((sum, p) => sum + p.len, 0)
  const avgdl = N > 0 ? totalLen / N : 0

  const results: Bm25Result[] = []
  for (const p of prepared) {
    if (mode === 'and' ? !qterms.every((t) => p.tf.has(t)) : p.tf.size === 0) continue
    let score = 0
    for (const t of qterms) {
      const f = p.tf.get(t)
      if (f === undefined) continue
      const idf = Math.log(1 + (N - df.get(t)! + 0.5) / (df.get(t)! + 0.5))
      const norm = avgdl > 0 ? p.len / avgdl : 1
      score += (idf * (f * (K1 + 1))) / (f + K1 * (1 - B + B * norm))
    }
    results.push({ path: p.doc.path, title: p.doc.title, score, snippet: makeSnippet(p.doc.body, qterms) })
  }

  return results.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    return a.title.localeCompare(b.title)
  })
}
