// Pure "related notes" similarity: rank notes by how much their content overlaps
// with a target note, using TF-IDF cosine similarity over their words. No fs/DOM
// access, so it is unit-testable and usable from the main process. This is the
// local, dependency-free precursor to the knowledge's vector retrieval — it
// surfaces semantically-adjacent notes you have *not* linked yet, complementing
// the explicit OKF links that drive the graph and backlinks.

export interface RelatedDoc {
  path: string
  title: string
  body: string
}

export interface RelatedNote {
  path: string
  title: string
  score: number // cosine similarity in (0, 1]; higher = more related
}

// A small English stop-word list: high-frequency words that carry little topical
// signal. Kept short on purpose — IDF already down-weights common words.
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'her',
  'was', 'one', 'our', 'out', 'has', 'had', 'his', 'how', 'its', 'who', 'get',
  'she', 'him', 'this', 'that', 'with', 'from', 'they', 'have', 'will', 'your',
  'what', 'when', 'them', 'then', 'than', 'were', 'been', 'into', 'some', 'just',
  'like', 'more', 'over', 'also', 'such', 'only', 'very', 'much', 'most', 'each',
  'their', 'there', 'these', 'those', 'which', 'about', 'would', 'could', 'should',
])

// Split text into lowercase word tokens (length >= 3, no stop-words, no digits-
// only). Markdown punctuation is treated as a separator, so links and formatting
// don't pollute the vocabulary.
function tokenize(text: string): string[] {
  const out: string[] = []
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3) continue
    if (STOP_WORDS.has(raw)) continue
    if (/^\d+$/.test(raw)) continue
    out.push(raw)
  }
  return out
}

// Term-frequency map for one document.
function termFreqs(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>()
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1)
  }
  return tf
}

// Cosine similarity between two TF-IDF weighted vectors (term -> weight).
function cosine(a: Map<string, number>, b: Map<string, number>): number {
  // Iterate the smaller map for the dot product.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let dot = 0
  for (const [term, weight] of small) {
    const other = large.get(term)
    if (other !== undefined) dot += weight * other
  }
  if (dot === 0) return 0
  let magA = 0
  for (const w of a.values()) magA += w * w
  let magB = 0
  for (const w of b.values()) magB += w * w
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

/**
 * Rank notes related to `targetPath` by TF-IDF cosine similarity over their text
 * (title weighted by repetition into the body). Notes in `exclude` (e.g. the
 * target itself and notes already linked to/from it) are dropped, so the result
 * surfaces *new* connections. Returns up to `limit` hits with score > 0, best first.
 */
export function relatedNotes(
  docs: RelatedDoc[],
  targetPath: string,
  opts: { exclude?: Set<string>; limit?: number } = {},
): RelatedNote[] {
  const exclude = opts.exclude ?? new Set<string>()
  const limit = opts.limit ?? 5

  // Tokenize every doc once. The title is repeated so a shared title term counts
  // as much as a few body occurrences.
  const tokensByPath = new Map<string, string[]>()
  for (const doc of docs) {
    tokensByPath.set(doc.path, [...tokenize(doc.title), ...tokenize(doc.title), ...tokenize(doc.body)])
  }

  const targetTokens = tokensByPath.get(targetPath)
  if (!targetTokens || targetTokens.length === 0) return []

  // Document frequency across the corpus, for IDF.
  const df = new Map<string, number>()
  for (const tokens of tokensByPath.values()) {
    for (const term of new Set(tokens)) {
      df.set(term, (df.get(term) ?? 0) + 1)
    }
  }
  const n = docs.length
  const idf = (term: string): number => Math.log(1 + n / (df.get(term) ?? 1))

  const toVector = (tokens: string[]): Map<string, number> => {
    const vec = new Map<string, number>()
    for (const [term, freq] of termFreqs(tokens)) {
      vec.set(term, freq * idf(term))
    }
    return vec
  }

  const targetVec = toVector(targetTokens)

  const scored: RelatedNote[] = []
  for (const doc of docs) {
    if (doc.path === targetPath || exclude.has(doc.path)) continue
    const score = cosine(targetVec, toVector(tokensByPath.get(doc.path)!))
    if (score > 0) scored.push({ path: doc.path, title: doc.title, score })
  }

  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
  return scored.slice(0, limit)
}
