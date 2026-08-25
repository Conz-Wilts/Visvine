// The rerank stage of the fused search, as a model judging the head of the
// ranking listwise: it sees the query and every candidate together and returns
// a relevance score per key. Off unless CONTEXT_RERANK=llm — it costs one model
// round-trip per search — and absent when no chat model is configured. Any
// failure returns [] and the fused order stands (shared/retrieval.ts#rerankHead).
//
// A cross-encoder would be the cheaper judge, but it is a native runtime and a
// model download on a scale-to-zero runtime; a chat call is what is already
// configured. Scores outside [0, 1] and keys the model invented are dropped.

import { aiConfigured, chat, extractJsonObject } from './ai'
import type { Reranker } from './shared/retrieval'
import { logger } from '@/lib/logger'

const SYSTEM =
  'You are a search reranker for a knowledge base of notes. Given a query and numbered candidates, ' +
  'score how well EACH candidate answers the query from 0 (irrelevant) to 1 (directly answers it). ' +
  'Judge meaning, not word overlap. Return ONLY JSON: {"scores": [{"id": number, "score": number}, ...]} covering every candidate.'

export function createReranker(): Reranker | undefined {
  if (process.env.CONTEXT_RERANK !== 'llm' || !aiConfigured()) return undefined
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
