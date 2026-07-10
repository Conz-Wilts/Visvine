// The fused search stack, ported from blackbird-brain's src/shared/retrieval.ts:
// frontmatter/tag filter → BM25 → optional vector stage → link-graph neighborhood
// expansion, combined with Reciprocal-Rank Fusion. Pure — the visibility lens
// (shared/visibility.ts) is applied by the caller BEFORE candidates are assembled,
// so nothing inaccessible can rank. The vector stage is injected (pgvector-backed
// on the server, absent in tests) and degrading it to [] leaves BM25 + graph.

import type { NoteMeta } from './types'
import { bm25Search } from './bm25'
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
}

/**
 * The embeddings stage: ranks docs by semantic similarity to the query. `mtime`
 * lets the stage key its cache; a stage returning [] contributes nothing to the
 * fusion (BM25 + graph carry the search).
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
  /** Expand the top BM25 hits with their link neighborhood (default true). */
  graphExpand?: boolean
}

const RRF_K = 60
const GRAPH_SEED = 5

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

function rankMap(paths: string[]): Map<string, number> {
  const m = new Map<string, number>()
  paths.forEach((p, i) => m.set(p, i))
  return m
}

/**
 * Run the fused stack over the given (already visibility-filtered) notes.
 * Returns the top-k notes, RRF-fused across BM25, an optional vector stage, and
 * a graph-neighborhood expansion of the strongest text hits.
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

  const stages: Map<string, number>[] = [rankMap(bm25.map((r) => r.path))]

  if (opts.vector) {
    const v = await opts.vector.rank(query, docs)
    v.sort((a, b) => b.score - a.score)
    stages.push(rankMap(v.map((r) => r.path)))
  }

  if (opts.graphExpand !== false) {
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
    if (neighbors.length) stages.push(rankMap(neighbors))
  }

  const fused = new Map<string, number>()
  for (const stage of stages) {
    for (const [path, rank] of stage) {
      fused.set(path, (fused.get(path) ?? 0) + 1 / (RRF_K + rank + 1))
    }
  }

  const snippetByPath = new Map(bm25.map((r) => [r.path, r.snippet]))
  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([path, score]) => ({
      path,
      title: byPath.get(path)!.meta.title,
      score,
      snippet: snippetByPath.get(path),
    }))
}
