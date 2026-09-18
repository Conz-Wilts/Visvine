// The fused search stack: query plan (shared/queryPlan.ts) → frontmatter/tag/date
// filter → BM25 over notes → optional note-vector stage → derived memories
// (claims, folded onto their notes) → source chunks (semantic + keyword) →
// link-context neighborhood expansion, combined with WEIGHTED
// Reciprocal-Rank Fusion (see STAGE_WEIGHTS) → lifecycle weighting → optional
// rerank of the over-fetched head. Every alternate phrasing in the plan runs the
// text and vector stages again as a lower-weighted stage of its own, so a
// differently-worded note reaches the fusion through the phrasing that matches
// it. A temporal-only plan ("what happened last week") skips the text stages
// entirely and answers by recency inside the range.
//
// Pure — the visibility lens (shared/visibility.ts) is applied by the caller
// BEFORE candidates are assembled, so nothing inaccessible can rank. The vector,
// source and rerank stages are injected (Postgres/LLM-backed on the server,
// absent in tests) and degrading any of them to [] leaves BM25 + context.

import type { NoteMeta } from './types'
import { bm25Search, snippetFor } from './bm25'
import { folderIdOfPath } from './placement'
import { retrievalWeight, statusOf, type NoteStatus } from './lifecycle'
import { inDateRange, noteTimeOf, planQuery, type QueryPlan } from './queryPlan'

export interface SearchFilters {
  /** Frontmatter `type`. */
  type?: string
  /** Top-level folder id ('' = shared-context root). */
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
  /** What the hit is: a context note (default) or a context-source chunk. */
  kind: 'note' | 'source'
  /** Chunk index within the source — set only when kind is 'source'. */
  seq?: number
  /**
   * The derived memory that matched — one self-contained sentence from the note
   * (lib/notes/shared/memories.ts), present when the memory stage found one.
   * It is the answer-sized form of the hit: a caller that needs only what the
   * note SAYS about the query can stop here rather than reading the note.
   */
  claim?: string
  /**
   * The section of the note that matched — the best-scoring chunk
   * (lib/notes/shared/noteChunks.ts), present when the chunk stage found one.
   * Where `claim` is what the note asserts, `passage` is where it says it: a
   * caller that needs the surrounding prose, not just the sentence, reads
   * this instead of the whole note.
   */
  passage?: { heading: string; text: string }
  /**
   * How relevant a judging reranker found the hit to the query, 0..1 — present
   * only when one ran and answered for this hit.
   */
  relevance?: number
  /**
   * The note's memory lifecycle state, present only when it is NOT `active` —
   * so a caller (and an agent) is told when a hit is superseded, expired or
   * stale, and never has to assume a result is current. Sources have none.
   */
  status?: NoteStatus
}

/**
 * The order for hits that came from DIFFERENT searches — a house and its rooms,
 * or several spaces. A fused score is a rank inside one corpus and means nothing
 * next to another corpus's; a judged `relevance` is the same question asked of
 * every hit, so it is the one number that compares. Judged hits lead, by
 * relevance; the rest follow by score, as before.
 */
export function compareAcrossSearches(a: FusedResult, b: FusedResult): number {
  if (a.relevance !== undefined && b.relevance !== undefined) return b.relevance - a.relevance || b.score - a.score
  if (a.relevance !== undefined) return -1
  if (b.relevance !== undefined) return 1
  return b.score - a.score
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

/** One ranked derived memory: the claim, and the note it came from. */
export interface MemoryStageHit {
  path: string
  seq: number
  text: string
  score: number
}

/**
 * The derived-memory stage: ranks the one-sentence claims extracted from notes
 * (lib/notes/memoryStage.ts on the server). Every hit is keyed to its NOTE in
 * the fusion — a memory is evidence for the note it came from, not a result of
 * its own — and the best-scoring claim per note becomes the result's `claim`.
 * Same two halves as sources: semantic (silent without a key) and keyword.
 */
export interface MemoryStage {
  rank(query: string): Promise<MemoryStageHit[]>
  keyword?(query: string): Promise<MemoryStageHit[]>
}

/** One ranked note chunk: the passage, and the note it came from. */
export interface ChunkStageHit {
  path: string
  seq: number
  heading: string
  text: string
  score: number
}

/**
 * The note-chunk stage: ranks the section-sized chunks of notes
 * (lib/notes/chunkStage.ts on the server). Like memories, every hit is keyed
 * to its NOTE in the fusion — a chunk is a place in a note, not a result of
 * its own — and the best-scoring chunk per note becomes the result's
 * `passage`. Semantic only: BM25 already covers the note's words.
 */
export interface ChunkStage {
  rank(query: string): Promise<ChunkStageHit[]>
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

/**
 * The rerank stage: re-scores the over-fetched head of the fused ranking with
 * something that reads query and candidate TOGETHER (a cross-encoder, or a
 * model asked to judge) rather than scoring them apart. Injected like the other
 * stages; a stage that returns [] (or throws inside, on the server) leaves the
 * fused order as it was. Keys it does not score keep their fused position
 * below the ones it did.
 *
 * A reranker whose score is an absolute relevance (a calibrated judge, not a
 * listwise ordering) may set `floor`: a scored key under it is DROPPED, and so
 * is everything past the head it read — a search may then return fewer than k
 * hits, or none, which is the honest answer when nothing in reach is about the
 * query. A key in the head it failed to score is kept: no verdict is never a
 * reason to lose a result.
 */
export interface Reranker {
  rerank(query: string, candidates: { key: string; text: string }[]): Promise<{ key: string; score: number }[]>
  floor?: number
}

export interface FuseOptions {
  k?: number
  vector?: VectorStage
  /** Rank context-source chunks alongside notes (BM25 does not cover sources). */
  sources?: SourceStage
  /** Rank derived memories, folded onto their notes. */
  memories?: MemoryStage
  /** Rank note chunks, folded onto their notes. */
  chunks?: ChunkStage
  /** Expand the top BM25 hits with their link neighborhood (default true). */
  contextExpand?: boolean
  /**
   * The plan to run. Defaults to the deterministic plan for `query` at `now`.
   */
  plan?: QueryPlan
  /** Epoch ms for relative dates in the query (default: the wall clock). */
  now?: number
  rerank?: Reranker
}

const RRF_K = 60
const GRAPH_SEED = 5
/**
 * How far an alternate phrasing is trusted next to the query as asked. It is
 * a paraphrase — usually right, sometimes a drift — so a hit it alone finds
 * should rank below one the original found, not tie with it.
 */
const ALTERNATE_WEIGHT = 0.7
/** How many candidates past `k` are fused when a reranker will look at them. */
const OVERFETCH = 3
/** The most candidates a reranker is handed — it reads every one. */
const RERANK_WINDOW = 30
/** The least a dropping reranker reads, whatever k is. */
const DROPPING_HEAD = 24
/** Characters of a candidate a reranker sees. */
const RERANK_TEXT_CHARS = 900

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
  // A claim is a sentence the note asserts, matched on its own: the most
  // precise evidence a note can offer, so it stands level with the direct
  // matchers rather than behind them.
  memoryVector: 1,
  memoryKeyword: 0.9,
  // A chunk is one section of the note matched on its own — the whole-note
  // vector's precise sibling, so it stands with the direct matchers too.
  chunkVector: 1,
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

/**
 * Frontmatter pre-filter — cheapest and most precise stage. The time bounds
 * apply to the note's own time (`date:` when it has one, else mtime — see
 * `noteTimeOf`), because a meeting note is about the day it records.
 */
export function matchesFilters(m: NoteMeta, f: SearchFilters): boolean {
  if (f.type && m.frontmatter.type !== f.type) return false
  if (f.folderId !== undefined && folderIdOfPath(m.path) !== f.folderId) return false
  if (f.tags && f.tags.length) {
    const have = new Set(m.tags.map((t) => t.toLowerCase()))
    if (!f.tags.every((t) => have.has(t.toLowerCase()))) return false
  }
  if (f.updatedAfter !== undefined || f.updatedBefore !== undefined) {
    if (!inDateRange(noteTimeOf(m), { start: f.updatedAfter ?? null, end: f.updatedBefore ?? null })) return false
  }
  return true
}

/**
 * The filters a search actually runs with: the caller's, plus the plan's date
 * range when the caller gave no time bound at all. A caller who bounded the
 * time has said what period they mean; mixing one of their bounds with one
 * read out of the words would build a range nobody asked for.
 */
function effectiveFilters(filters: SearchFilters, plan: QueryPlan): SearchFilters {
  const r = plan.dateRange
  if (!r || filters.updatedAfter !== undefined || filters.updatedBefore !== undefined) return filters
  return { ...filters, updatedAfter: r.start ?? undefined, updatedBefore: r.end ?? undefined }
}

/**
 * Run the fused stack over the given (already visibility-filtered) notes.
 * Returns the top-k notes, RRF-fused across BM25, an optional vector stage, and
 * a context-neighborhood expansion of the strongest text hits — for the query
 * as asked and for each alternate phrasing in the plan.
 */
export async function fusedSearch(
  notes: RetrievalNote[],
  query: string,
  filters: SearchFilters,
  opts: FuseOptions = {},
): Promise<FusedResult[]> {
  const k = opts.k ?? 8
  const plan = opts.plan ?? planQuery(query, opts.now ?? Date.now())
  const effective = effectiveFilters(filters, plan)
  const candidates = notes.filter((n) => matchesFilters(n.meta, effective))
  const byPath = new Map(candidates.map((n) => [n.meta.path, n]))
  // A history question wants the retired note; don't bury it.
  const lifecycle = plan.intent === 'history' ? () => 1 : retrievalWeight

  if (plan.temporalOnly) return byRecency(candidates, k, lifecycle)

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

  // The text the stages rank on: the topic once time words are stripped, then
  // each alternate phrasing at a discount. A plan carries the original first.
  const phrasings = [plan.topic || query, ...plan.queries.slice(1)]
  const stages: Stage[] = []
  const bm25ByPhrasing = phrasings.map((q) => bm25Search(docs, q))
  phrasings.forEach((_q, i) => {
    const w = i === 0 ? 1 : ALTERNATE_WEIGHT
    stages.push(stageOf(STAGE_WEIGHTS.bm25 * w, bm25ByPhrasing[i].map((r) => ({ key: r.path, score: r.score }))))
  })

  if (opts.vector) {
    for (const [i, q] of phrasings.entries()) {
      const v = await opts.vector.rank(q, docs)
      if (!v.length) continue
      v.sort((a, b) => b.score - a.score)
      const w = i === 0 ? 1 : ALTERNATE_WEIGHT
      stages.push(stageOf(STAGE_WEIGHTS.vector * w, v.map((r) => ({ key: r.path, score: r.score }))))
    }
  }

  // Source chunks join the fusion under composite keys ("source:<path>#<seq>")
  // so they can never collide with a note path. Type/tag filters are note
  // frontmatter concepts, so a filtered search skips sources entirely; the
  // folderId filter is applied by the caller when selecting visible paths.
  const sourceHitByKey = new Map<string, SourceStageHit>()
  if (opts.sources && !filters.type && !(filters.tags && filters.tags.length)) {
    const keyOf = (h: SourceStageHit) => `source:${h.path}#${h.seq}`
    for (const [i, q] of phrasings.entries()) {
      const w = i === 0 ? 1 : ALTERNATE_WEIGHT
      const rankings: [number, SourceStageHit[]][] = [
        [STAGE_WEIGHTS.sourceVector * w, await opts.sources.rank(q)],
        [STAGE_WEIGHTS.sourceKeyword * w, (await opts.sources.keyword?.(q)) ?? []],
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
  }

  // Derived memories fold onto their note: the stage ranks claims, the fusion
  // sees notes. Several claims from one note collapse to that note's best rank
  // (a note that says three relevant things is not three notes), and the
  // best-scoring claim per note is kept as the result's `claim`.
  const claimByPath = new Map<string, { text: string; score: number }>()
  if (opts.memories && !plan.temporalOnly) {
    for (const [i, q] of phrasings.entries()) {
      const w = i === 0 ? 1 : ALTERNATE_WEIGHT
      const rankings: [number, MemoryStageHit[]][] = [
        [STAGE_WEIGHTS.memoryVector * w, await opts.memories.rank(q)],
        [STAGE_WEIGHTS.memoryKeyword * w, (await opts.memories.keyword?.(q)) ?? []],
      ]
      for (const [weight, hits] of rankings) {
        const perNote = new Map<string, MemoryStageHit>()
        for (const h of hits) {
          if (!byPath.has(h.path)) continue // a stale or invisible claim never ranks
          const best = perNote.get(h.path)
          if (!best || h.score > best.score) perNote.set(h.path, h)
          const claim = claimByPath.get(h.path)
          if (!claim || h.score * weight > claim.score) claimByPath.set(h.path, { text: h.text, score: h.score * weight })
        }
        if (!perNote.size) continue
        const ranked = [...perNote.values()].sort((a, b) => b.score - a.score)
        stages.push(stageOf(weight, ranked.map((h) => ({ key: h.path, score: h.score }))))
      }
    }
  }

  // Note chunks fold onto their note the same way: several matching sections
  // collapse to the note's best rank, and the best-scoring section per note is
  // kept as the result's `passage`.
  const passageByPath = new Map<string, { heading: string; text: string; score: number }>()
  if (opts.chunks && !plan.temporalOnly) {
    for (const [i, q] of phrasings.entries()) {
      const w = i === 0 ? 1 : ALTERNATE_WEIGHT
      const weight = STAGE_WEIGHTS.chunkVector * w
      const perNote = new Map<string, ChunkStageHit>()
      for (const h of await opts.chunks.rank(q)) {
        if (!byPath.has(h.path)) continue // a stale or invisible chunk never ranks
        const best = perNote.get(h.path)
        if (!best || h.score > best.score) perNote.set(h.path, h)
        const passage = passageByPath.get(h.path)
        if (!passage || h.score * weight > passage.score) {
          passageByPath.set(h.path, { heading: h.heading, text: h.text, score: h.score * weight })
        }
      }
      if (!perNote.size) continue
      const ranked = [...perNote.values()].sort((a, b) => b.score - a.score)
      stages.push(stageOf(weight, ranked.map((h) => ({ key: h.path, score: h.score }))))
    }
  }

  if (opts.contextExpand !== false) {
    const seed = bm25ByPhrasing[0].slice(0, GRAPH_SEED).map((r) => r.path)
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

  // Lifecycle weighting, applied AFTER fusion and only to notes: a superseded
  // decision is exactly as relevant to the query as its replacement — that is
  // why every matcher ranks it — and the only thing that separates them is that
  // one of them is no longer true. Nothing is filtered out; "why did we stop
  // doing X" must still find the note that says so — and when the plan says
  // that IS the question, the weighting is off. See shared/lifecycle.ts.
  for (const [key, score] of fused) {
    const note = byPath.get(key)
    if (!note) continue // source chunk — no frontmatter, no lifecycle
    const weight = lifecycle(note.meta)
    if (weight !== 1) fused.set(key, score * weight)
  }

  // Snippets: the original phrasing's window first, then an alternate's, then
  // one built for a note that reached the results through another stage.
  const snippetByPath = new Map<string, string>()
  for (const ranking of [...bm25ByPhrasing].reverse()) for (const r of ranking) snippetByPath.set(r.path, r.snippet)

  let ranked = [...fused.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    return (strongest.get(b[0]) ?? 0) - (strongest.get(a[0]) ?? 0)
  })

  const toResult = ([key, score]: [string, number]): FusedResult => {
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
    const status = statusOf(note.meta.frontmatter)
    const claim = claimByPath.get(key)
    const passage = passageByPath.get(key)
    return {
      path: key,
      title: note.meta.title,
      score,
      ...(status === 'active' ? {} : { status }),
      // A note surfaced only by the vector or link-context stage never passed
      // through BM25, so it has no snippet of its own — the matching passage
      // is the best preview, else build one rather than returning a result
      // the caller can't preview.
      snippet: snippetByPath.get(key) ?? (passage ? passage.text.slice(0, 240) : snippetFor(note.body, plan.topic || query)),
      ...(claim ? { claim: claim.text } : {}),
      ...(passage ? { passage: { heading: passage.heading, text: passage.text } } : {}),
      kind: 'note',
    }
  }

  const relevance = new Map<string, number>()
  // A history question ("why did we stop…") is about a note that no longer
  // says what the query says — a judge reading literally finds it off-topic, and
  // it IS the answer. A reranker that drops sits such a plan out.
  const sitsOut = opts.rerank?.floor !== undefined && plan.intent === 'history'
  if (opts.rerank && ranked.length > 0 && !sitsOut) {
    // A reranker that DROPS needs a deeper head than one that reorders: with
    // k = 5 a head of 15 that loses ten leaves five, and the sixth-best by
    // fusion — often the right note found by one stage only — was never read.
    const head = opts.rerank.floor === undefined ? k * OVERFETCH : Math.max(k * OVERFETCH, DROPPING_HEAD)
    ranked = await rerankHead(ranked, Math.min(RERANK_WINDOW, head), plan.topic || query, opts.rerank, (key) => {
      const r = toResult([key, 0])
      // What a reader would judge the hit by: what it is, what it says it is
      // about, and the part that matched. A match in the description or the
      // tags is invisible in a body snippet.
      const meta = byPath.get(key)?.meta
      const about = [
        typeof meta?.frontmatter.type === 'string' ? `Type: ${meta.frontmatter.type}` : '',
        typeof meta?.frontmatter.description === 'string' ? meta.frontmatter.description : '',
        meta?.tags.length ? `Tags: ${meta.tags.join(', ')}` : '',
      ].filter(Boolean)
      const text = [...about, r.claim, r.passage?.text ?? r.snippet].filter(Boolean).join('\n')
      return `${r.title}\n${text}`.slice(0, RERANK_TEXT_CHARS)
    }, (key) => {
      const note = byPath.get(key)
      return note ? lifecycle(note.meta) : 1
    }, relevance)
  }

  return ranked.slice(0, k).map((entry) => {
    const rel = relevance.get(entry[0])
    return rel === undefined ? toResult(entry) : { ...toResult(entry), relevance: Math.round(rel * 100) / 100 }
  })
}

/**
 * The temporal-only answer: every note in the range, newest first. Scored on
 * the same 1/(K + rank) scale as a fused hit so a caller comparing scores
 * across calls sees the same shape, and lifecycle-weighted for the same reason
 * fusion is — last week's retired note is still retired.
 */
function byRecency(
  candidates: RetrievalNote[],
  k: number,
  lifecycle: (meta: Pick<NoteMeta, 'frontmatter'>) => number,
): FusedResult[] {
  return candidates
    .map((n) => ({ n, time: noteTimeOf(n.meta) }))
    .sort((a, b) => b.time - a.time)
    .map(({ n }, i) => ({ n, score: (1 / (RRF_K + i + 1)) * lifecycle(n.meta) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ n, score }): FusedResult => {
      const status = statusOf(n.meta.frontmatter)
      return {
        path: n.meta.path,
        title: n.meta.title,
        score,
        ...(status === 'active' ? {} : { status }),
        snippet: snippetFor(n.body, ''),
        kind: 'note',
      }
    })
}

/**
 * Hand the head of the ranking to the reranker and put its order first. The
 * reranker's scores are lifecycle-weighted like fused scores are: it judges
 * relevance, and relevance is not currency. Anything it left unscored — or the
 * whole head, if it returned nothing — keeps its fused position.
 */
async function rerankHead(
  ranked: [string, number][],
  window: number,
  query: string,
  reranker: Reranker,
  textOf: (key: string) => string,
  weightOf: (key: string) => number,
  relevance: Map<string, number>,
): Promise<[string, number][]> {
  const head = ranked.slice(0, window)
  const scored = await reranker.rerank(query, head.map(([key]) => ({ key, text: textOf(key) })))
  if (!scored.length) return ranked
  const raw = new Map(scored.map((s) => [s.key, s.score]))
  const floor = reranker.floor
  const reranked = head
    .filter(([key]) => raw.has(key) && (floor === undefined || raw.get(key)! >= floor))
    .map(([key]): [string, number] => [key, raw.get(key)! * weightOf(key)])
    .sort((a, b) => b[1] - a[1])
  if (floor !== undefined) for (const [key] of reranked) relevance.set(key, raw.get(key)!)
  // With a floor the head is all that was read, so it is all that may come
  // back; without one the unread tail keeps its fused order below the head.
  const rest = (floor === undefined ? ranked : head).filter(([key]) => !raw.has(key))
  return [...reranked, ...rest]
}
