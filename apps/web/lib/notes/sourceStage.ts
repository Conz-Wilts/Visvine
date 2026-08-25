// The context-source stage of the fused search — the chunk-level sibling of
// vectorStage.ts. Chunks are embedded at ingest time (no lazy re-embed here;
// stale-model chunks simply don't rank until reingest), so the semantic half is
// one cosine ranking in Postgres against the query vectors the caller already
// embedded (one per phrasing in the plan, looked up by text), over the caller's
// VISIBLE source paths.
//
// The keyword half exists because BM25 upstream only sees notes: without it an
// upload that was never embedded (no key at ingest, or an embed failure —
// sources/ingest.ts stores those chunks with model = null) cannot be found by
// any means at all. It is index-backed full text, so it costs nothing per query
// and works with no API key.

import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import type { Context } from './store'
import type { SourceStage, SourceStageHit } from './shared/retrieval'
import { embeddingsConfig } from './embeddings'
import { aboveFloors, vectorLiteral, type SemanticReport } from './vectorStage'
import { logger } from '@/lib/logger'

const TOP_K = 20
const SNIPPET_CHARS = 240

export function createSourceStage(
  context: Context,
  visiblePaths: string[],
  queryVectors: ReadonlyMap<string, number[]>,
  report: SemanticReport = {},
): SourceStage {
  return {
    async rank(query): Promise<SourceStageHit[]> {
      try {
        const config = embeddingsConfig()
        const queryVector = queryVectors.get(query)
        if (!config || !queryVector || visiblePaths.length === 0) return []

        const rows = await prisma.$queryRaw<
          { path: string; seq: number; text: string; score: number }[]
        >`
          SELECT path, seq, text, 1 - (embedding <=> ${vectorLiteral(queryVector)}::vector) AS score
          FROM context_source_chunks
          WHERE space_id = ${context.spaceId}
            AND owner_key = ${context.ownerKey}
            AND model = ${config.model}
            AND embedding IS NOT NULL
            AND path IN (${Prisma.join(visiblePaths)})
          ORDER BY score DESC
          LIMIT ${TOP_K}`

        return aboveFloors(rows).map(toHit)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        report.error ??= message
        logger.error('notes.search.source_stage_failed', { err })
        return []
      }
    },

    async keyword(query: string): Promise<SourceStageHit[]> {
      try {
        if (visiblePaths.length === 0 || !query.trim()) return []
        // websearch_to_tsquery takes user syntax (quoted phrases, OR, -term)
        // without ever throwing on malformed input, unlike to_tsquery. The
        // to_tsvector expression matches the GIN index exactly — change one and
        // the index stops being used.
        const rows = await prisma.$queryRaw<
          { path: string; seq: number; text: string; score: number }[]
        >`
          SELECT path, seq, text,
                 ts_rank(to_tsvector('english', text), websearch_to_tsquery('english', ${query})) AS score
          FROM context_source_chunks
          WHERE space_id = ${context.spaceId}
            AND owner_key = ${context.ownerKey}
            AND path IN (${Prisma.join(visiblePaths)})
            AND to_tsvector('english', text) @@ websearch_to_tsquery('english', ${query})
          ORDER BY score DESC
          LIMIT ${TOP_K}`

        return rows.map(toHit)
      } catch (err) {
        // Keyword search over chunks is best-effort like every other stage.
        logger.error('notes.search.source_keyword_failed', { err })
        return []
      }
    },
  }
}

function toHit(r: { path: string; seq: number; text: string; score: number }): SourceStageHit {
  return { path: r.path, seq: r.seq, snippet: r.text.slice(0, SNIPPET_CHARS), score: r.score }
}
