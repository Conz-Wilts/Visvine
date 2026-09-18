// The rerank stage of the fused search. Two judges:
//
// The JUDGE (default when the deployment has a key): Jev scores each candidate
// against the query on its own, in parallel — is it about the query, does it
// state something that answers it. The score is an absolute relevance, so this
// reranker carries a `floor` and the search DROPS what falls under it: a query
// nothing in reach is about comes back empty rather than padded with noise.
// `report.judged` says it ran, which is what lets the caller tell "nothing
// relevant" from "nothing found". It reads the first JUDGE_WINDOW candidates;
// one it could not score is kept.
//
// The LISTWISE model (CONTEXT_RERANK=llm): a chat model sees the query and every
// candidate together and returns a score per key. It only reorders. It costs one
// model round-trip per search. CONTEXT_RERANK=off runs neither. Any
// failure returns [] and the fused order stands (shared/retrieval.ts#rerankHead).
//
// A cross-encoder would be the cheaper judge, but it is a native runtime and a
// model download on a scale-to-zero runtime; a chat call is what is already
// configured. Scores outside [0, 1] and keys the model invented are dropped.

import { aiConfigured, chat, extractJsonObject } from './ai'
import { compareAcrossSearches, type FusedResult, type Reranker } from './shared/retrieval'
import { logger } from '@/lib/logger'
import { decideMany, judgeConfigured, MAX_BATCH } from '@/lib/judge/client'
import { noulOf } from '@/lib/judge/shared/types'
import { CONFLICT_AT, CONFLICT_QUESTION, SEARCH_QUESTIONS, SEARCH_RELEVANT_FLOOR, searchScore } from '@/lib/judge/shared/questions'

/** Candidates the judge reads: two batches, inside one search's patience. */
const JUDGE_WINDOW = MAX_BATCH * 2
const JUDGE_DEADLINE_MS = 2_000

export interface RerankReport {
  /** True when the judge answered for at least one candidate. */
  judged?: boolean
}

function judgeReranker(report: RerankReport): Reranker {
  return {
    floor: SEARCH_RELEVANT_FLOOR,
    async rerank(query, candidates) {
      const read = candidates.slice(0, JUDGE_WINDOW)
      const answers = await decideMany(
        read.map((c) => {
          const [title, ...rest] = c.text.split('\n')
          return { state: { query, passage: { title, text: rest.join('\n') } }, questions: SEARCH_QUESTIONS }
        }),
        { deadlineMs: JUDGE_DEADLINE_MS },
      )
      const out: { key: string; score: number }[] = []
      answers.forEach((a, i) => {
        const relevant = noulOf(a, 'relevant')
        if (relevant === undefined) return
        // Under the floor on relevance alone → 0, which the floor drops; a
        // relevant hit never scores under the floor for stating little.
        const score = relevant < SEARCH_RELEVANT_FLOOR ? 0 : Math.max(SEARCH_RELEVANT_FLOOR, searchScore(relevant, noulOf(a, 'answers')))
        out.push({ key: read[i].key, score })
      })
      // Candidates past the window were not read; score them at the floor so
      // they are kept, below everything the judge placed.
      if (out.length) {
        report.judged = true
        for (const c of candidates.slice(JUDGE_WINDOW)) out.push({ key: c.key, score: SEARCH_RELEVANT_FLOOR })
      }
      return out
    },
  }
}

const SYSTEM =
  'You are a search reranker for a knowledge base of notes. Given a query and numbered candidates, ' +
  'score how well EACH candidate answers the query from 0 (irrelevant) to 1 (directly answers it). ' +
  'Judge meaning, not word overlap. Return ONLY JSON: {"scores": [{"id": number, "score": number}, ...]} covering every candidate.'

/**
 * Judge hits that were already gathered — the fold of several spaces' searches,
 * which is judged ONCE after folding rather than once per space: a dozen spaces
 * would otherwise each spend a window of requests on candidates most of which
 * never reach the answer. Same floor, same ordering, same fail-open as the
 * in-search stage. `judged` is false when no judge ran and `hits` is the input.
 */
export async function judgeHits<T extends FusedResult>(query: string, hits: T[], k: number): Promise<{ hits: T[]; judged: boolean }> {
  const report: RerankReport = {}
  if (process.env.CONTEXT_RERANK?.trim().toLowerCase() === 'off' || !judgeConfigured() || !hits.length) {
    return { hits: hits.slice(0, k), judged: false }
  }
  const head = hits.slice(0, JUDGE_WINDOW)
  const scored = await judgeReranker(report).rerank(
    query,
    head.map((h, i) => ({ key: String(i), text: `${h.title}\n${[h.claim, h.passage?.text ?? h.snippet].filter(Boolean).join('\n')}`.slice(0, 900) })),
  )
  if (!report.judged) return { hits: hits.slice(0, k), judged: false }
  const byIndex = new Map(scored.map((s) => [Number(s.key), s.score]))
  const kept: T[] = []
  head.forEach((h, i) => {
    const score = byIndex.get(i)
    if (score === undefined) kept.push(h)
    else if (score >= SEARCH_RELEVANT_FLOOR) kept.push({ ...h, relevance: Math.round(score * 100) / 100 })
  })
  kept.sort(compareAcrossSearches)
  return { hits: kept.slice(0, k), judged: true }
}

export function createReranker(report: RerankReport = {}): Reranker | undefined {
  const mode = process.env.CONTEXT_RERANK?.trim().toLowerCase()
  if (mode === 'off') return undefined
  if (mode !== 'llm') return judgeConfigured() ? judgeReranker(report) : undefined
  if (!aiConfigured()) return undefined
  return {
    async rerank(query, candidates) {
      try {
        const listing = candidates
          .map((c, i) => `[${i}] ${c.text.replace(/\s+/g, ' ').trim()}`)
          .join('\n')
        const raw = await chat([
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Query: ${query}\n\nCandidates:\n${listing}` },
        ])
        const parsed = extractJsonObject(raw) as { scores?: unknown }
        const out: { key: string; score: number }[] = []
        for (const item of Array.isArray(parsed.scores) ? parsed.scores : []) {
          const r = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}
          const id = typeof r.id === 'number' ? r.id : Number(r.id)
          const score = typeof r.score === 'number' ? r.score : Number(r.score)
          if (!Number.isInteger(id) || !candidates[id] || !Number.isFinite(score) || score < 0 || score > 1) continue
          out.push({ key: candidates[id].key, score })
        }
        return out
      } catch (err) {
        logger.warn('notes.search.rerank_failed', { err })
        return []
      }
    },
  }
}

/** Top hits compared for conflict: three hits is three pairs, one batch. */
const CONFLICT_HEAD = 3
const CONFLICT_DEADLINE_MS = 1_200

/**
 * Mark the leading hits that state conflicting facts about the same subject, so
 * a caller is told the record disagrees with itself instead of acting on
 * whichever hit it read first. Judged on what each hit SAYS — its claim, else
 * its matched passage. Which one is current is the notes' lifecycle to say
 * (`status`, `superseded_by`), not the judge's. No verdict marks nothing.
 */
export async function flagConflicts<T extends FusedResult>(hits: T[]): Promise<(T & { conflicts_with?: string[] })[]> {
  const head = hits.slice(0, CONFLICT_HEAD).filter((h) => h.kind === 'note' && h.relevance !== undefined && (h.claim || h.passage))
  if (head.length < 2 || !judgeConfigured()) return hits
  const pairs: [T, T][] = []
  for (let i = 0; i < head.length; i++) for (let j = i + 1; j < head.length; j++) pairs.push([head[i], head[j]])
  const said = (h: T) => ({ title: h.title, statements: [h.claim, h.passage?.text].filter(Boolean) })
  const answers = await decideMany(
    pairs.map(([a, b]) => ({ state: { a: said(a), b: said(b) }, questions: { conflict: CONFLICT_QUESTION } })),
    { deadlineMs: CONFLICT_DEADLINE_MS },
  )
  const against = new Map<string, string[]>()
  pairs.forEach(([a, b], i) => {
    const conflict = noulOf(answers[i], 'conflict')
    if (conflict === undefined || conflict < CONFLICT_AT) return
    against.set(a.path, [...(against.get(a.path) ?? []), b.path])
    against.set(b.path, [...(against.get(b.path) ?? []), a.path])
  })
  return against.size ? hits.map((h) => (against.has(h.path) ? { ...h, conflicts_with: against.get(h.path) } : h)) : hits
}
