// The fused search stack, ported from blackbird-brain's src/shared/retrieval.ts:
// frontmatter/tag filter → BM25 over notes → optional note-vector stage → source
// chunks (semantic + keyword) → link-context neighborhood expansion, combined with
// WEIGHTED Reciprocal-Rank Fusion (see STAGE_WEIGHTS). Pure — the visibility lens
// (shared/visibility.ts) is applied by the caller BEFORE candidates are assembled,
// so nothing inaccessible can rank. The vector stage is injected (pgvector-backed
// on the server, absent in tests) and degrading it to [] leaves BM25 + context.

import type { NoteMeta } from './types'
import { bm25Search, snippetFor } from './bm25'
import { folderIdOfPath } from './placement'

export interface SearchFilters {
  /** Frontmatter `type`. */
  type?: string
  /** Top-level folder id ('' = shared-brain root). */
  folderId?: string
  /** Every tag must be present (case-insensitive). */
  tags?: string[]
  /** Inclusive epoch-ms bounds on the note's last-modified time. */
  updatedAfter?: number
  updatedBefore?: number
}

export interface RetrievalNote {
  meta: NoteMeta
  body: string
}

export interface FusedResult {
  path: string
  title: string
  score: number
  snippet?: string
  /** What the hit is: a brain note (default) or a context-source chunk. */
  kind: 'note' | 'source'
  /** Chunk index within the source — set only when kind is 'source'. */
  seq?: number
}

/** One ranked context-source chunk from the injected source stage. */
export interface SourceStageHit {
  path: string
  seq: number
  snippet: string
  score: number
}

/**
 * The context-source stage: ranks source CHUNKS. Like VectorStage it is injected
 * (Postgres-backed on the server, absent in tests) and a stage returning []
 * contributes nothing to the fusion. The caller passes only VISIBLE source paths
 * to the stage factory, so nothing inaccessible ranks.
 *
 * Two rankings, because a chunk has no other way into the results: `rank` is
 * semantic (pgvector, silent when embeddings are unconfigured) and `keyword` is
 * full-text (always available). Without the keyword half an unembedded upload is
 * invisible to search entirely — BM25 above only ever sees notes.
 */
export interface SourceStage {
  rank(query: string): Promise<SourceStageHit[]>
  keyword?(query: string): Promise<SourceStageHit[]>
}

/**
 * The embeddings stage: ranks docs by semantic similarity to the query. `mtime`
 * lets the stage key its cache; a stage returning [] contributes nothing to the
 * fusion (BM25 + context carry the search).
 */
export interface VectorStage {
  rank(
    query: string,
    docs: { path: string; title: string; body: string; mtime?: number }[],
  ): Promise<{ path: string; score: number }[]>
}

export interface FuseOptions {
  k?: number
  vector?: VectorStage
  /** Rank context-source chunks alongside notes (BM25 does not cover sources). */
  sources?: SourceStage
  /** Expand the top BM25 hits with their link neighborhood (default true). */
  contextExpand?: boolean
}

const RRF_K = 60
const GRAPH_SEED = 5

/**
 * Per-stage fusion weights. Plain RRF treats every stage as equally good
 * evidence, which is wrong here: the link-context stage is a recall net (these
 * notes are merely ADJACENT to a text hit and were never matched against the
 * query at all), so at weight 1 a well-connected neighbour outranks a genuine
 * keyword match further down the list. The two direct matchers stay at 1.
 */
export const STAGE_WEIGHTS = {
  bm25: 1,
  vector: 1,
  sourceKeyword: 0.9,
  sourceVector: 0.8,
  context: 0.4,
} as const

interface Stage {
  weight: number
  /** path/key → rank position (0 = best). */
  ranks: Map<string, number>
  /** path/key → this stage's own score, normalized to its own top hit. */
  strength?: Map<string, number>
}

function stageOf(
  weight: number,
  entries: { key: string; score?: number }[],
): Stage {
  const ranks = new Map<string, number>()
  const strength = new Map<string, number>()
  const top = entries[0]?.score
  entries.forEach((e, i) => {
    ranks.set(e.key, i)
    if (e.score !== undefined && top) strength.set(e.key, e.score / top)
  })
  return { weight, ranks, strength }
}

/** Frontmatter pre-filter — cheapest and most precise stage. */
export function matchesFilters(m: NoteMeta, f: SearchFilters): boolean {
  if (f.type && m.frontmatter.type !== f.type) return false
  if (f.folderId !== undefined && folderIdOfPath(m.path) !== f.folderId) return false
  if (f.tags && f.tags.length) {
    const have = new Set(m.tags.map((t) => t.toLowerCase()))
    if (!f.tags.every((t) => have.has(t.toLowerCase()))) return false
  }
  if (f.updatedAfter !== undefined && m.mtime < f.updatedAfter) return false
  if (f.updatedBefore !== undefined && m.mtime > f.updatedBefore) return false
  return true
}

/**
 * Run the fused stack over the given (already visibility-filtered) notes.
 * Returns the top-k notes, RRF-fused across BM25, an optional vector stage, and
 * a context-neighborhood expansion of the strongest text hits.
 */
export async function fusedSearch(
  notes: RetrievalNote[],
  query: string,
  filters: SearchFilters,
  opts: FuseOptions = {},
): Promise<FusedResult[]> {
  const k = opts.k ?? 8
  const candidates = notes.filter((n) => matchesFilters(n.meta, filters))
  const byPath = new Map(candidates.map((n) => [n.meta.path, n]))

  const docs = candidates.map((n) => ({
    path: n.meta.path,
    title: n.meta.title,
    body: n.body,
    tags: n.meta.tags,
    aliases: Array.isArray(n.meta.frontmatter.aliases)
      ? (n.meta.frontmatter.aliases as unknown[]).map(String)
      : undefined,
    mtime: n.meta.mtime,
  }))
  const bm25 = bm25Search(docs, query)

  const stages: Stage[] = [
    stageOf(STAGE_WEIGHTS.bm25, bm25.map((r) => ({ key: r.path, score: r.score }))),
  ]

  if (opts.vector) {
    const v = await opts.vector.rank(query, docs)
    v.sort((a, b) => b.score - a.score)
    stages.push(stageOf(STAGE_WEIGHTS.vector, v.map((r) => ({ key: r.path, score: r.score }))))
  }

  // Source chunks join the fusion under composite keys ("source:<path>#<seq>")
  // so they can never collide with a note path. Type/tag filters are note
  // frontmatter concepts, so a filtered search skips sources entirely; the
  // folderId filter is applied by the caller when selecting visible paths.
  const sourceHitByKey = new Map<string, SourceStageHit>()
  if (opts.sources && !filters.type && !(filters.tags && filters.tags.length)) {
    const keyOf = (h: SourceStageHit) => `source:${h.path}#${h.seq}`
    const rankings: [number, SourceStageHit[]][] = [
      [STAGE_WEIGHTS.sourceVector, await opts.sources.rank(query)],
      [STAGE_WEIGHTS.sourceKeyword, (await opts.sources.keyword?.(query)) ?? []],
    ]
    for (const [weight, hits] of rankings) {
      if (!hits.length) continue
      hits.sort((a, b) => b.score - a.score)
      // First writer wins the snippet: the semantic stage runs first and its
      // window is the one that matched.
      for (const h of hits) if (!sourceHitByKey.has(keyOf(h))) sourceHitByKey.set(keyOf(h), h)
      stages.push(stageOf(weight, hits.map((h) => ({ key: keyOf(h), score: h.score }))))
    }
  }

  if (opts.contextExpand !== false) {
    const seed = bm25.slice(0, GRAPH_SEED).map((r) => r.path)
    const seen = new Set(seed)
    const neighbors: string[] = []
    for (const p of seed) {
      const n = byPath.get(p)
      if (!n) continue
      for (const t of n.meta.linkTargets) {
        if (byPath.has(t) && !seen.has(t)) {
          seen.add(t)
          neighbors.push(t)
        }
      }
    }
    if (neighbors.length) {
      stages.push(stageOf(STAGE_WEIGHTS.context, neighbors.map((key) => ({ key }))))
    }
  }

  const fused = new Map<string, number>()
  // Best per-stage strength, kept as the tiebreak: RRF sees rank positions only,
  // so without it the #1 hit of a stage that matched nothing well ties with the
  // #1 hit of a stage that matched perfectly.
  const strongest = new Map<string, number>()
  for (const stage of stages) {
    for (const [path, rank] of stage.ranks) {
      fused.set(path, (fused.get(path) ?? 0) + stage.weight / (RRF_K + rank + 1))
      const s = stage.strength?.get(path)
      if (s !== undefined) strongest.set(path, Math.max(strongest.get(path) ?? 0, s))
    }
  }

  const snippetByPath = new Map(bm25.map((r) => [r.path, r.snippet]))
  return [...fused.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1]
      return (strongest.get(b[0]) ?? 0) - (strongest.get(a[0]) ?? 0)
    })
    .slice(0, k)
    .map(([key, score]): FusedResult => {
      const sourceHit = sourceHitByKey.get(key)
      if (sourceHit) {
        return {
          path: sourceHit.path,
          title: sourceHit.path.split('/').pop() ?? sourceHit.path,
          score,
          snippet: sourceHit.snippet,
          kind: 'source',
          seq: sourceHit.seq,
        }
      }
      const note = byPath.get(key)!
      return {
        path: key,
        title: note.meta.title,
        score,
        // A note surfaced only by the vector or link-context stage never passed
        // through BM25, so it has no snippet of its own — build one rather than
        // returning a result the caller can't preview.
        snippet: snippetByPath.get(key) ?? snippetFor(note.body, query),
        kind: 'note',
      }
    })
}
