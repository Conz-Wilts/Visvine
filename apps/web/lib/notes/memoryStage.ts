// The derived-memory stage of the fused search — ranks the claims extracted
// from notes (lib/notes/memorySweep.ts) and hands each hit back keyed to its
// note, so the fusion folds it onto the note it came from and the result can
// carry the claim as its answer. Two halves like the source stage: cosine over
// the claim vectors (pgvector, silent without a key) and Postgres full text
// (always on).
//
// Only claims from the CURRENT version of a visible note rank: the caller passes
// (path, mtime) of every note it may show, and the query matches both — a claim
// extracted from an older save is stale and is never served, and the note it
// came from still ranks on its own through BM25 and the note vector.

import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import type { Context } from './store'
import type { MemoryStage, MemoryStageHit } from './shared/retrieval'
import { embeddingsConfig } from './embeddings'
import { aboveFloors, vectorLiteral, type SemanticReport } from './vectorStage'
import { logger } from '@/lib/logger'

const TOP_K = 30

export function createMemoryStage(
  context: Context,
  visible: ReadonlyMap<string, number>,
  queryVectors: ReadonlyMap<string, number[]>,
  report: SemanticReport = {},
): MemoryStage {
  const identity = () =>
    Prisma.join([...visible.entries()].map(([path, mtime]) => Prisma.sql`(${path}, ${BigInt(mtime)}::bigint)`))

  return {
    async rank(query): Promise<MemoryStageHit[]> {
      try {
        const config = embeddingsConfig()
        const queryVector = queryVectors.get(query)
        if (!config || !queryVector || visible.size === 0) return []
        const rows = await prisma.$queryRaw<MemoryStageHit[]>`
          SELECT path, seq, text, 1 - (embedding <=> ${vectorLiteral(queryVector)}::vector) AS score
          FROM context_memories
          WHERE space_id = ${context.spaceId}
            AND owner_key = ${context.ownerKey}
            AND embed_model = ${config.model}
            AND embedding IS NOT NULL
            AND text <> ''
            AND (path, mtime) IN (${identity()})
          ORDER BY score DESC
          LIMIT ${TOP_K}`
        return aboveFloors(rows)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        report.error ??= message
        logger.error('notes.search.memory_stage_failed', { err })
        return []
      }
    },

    async keyword(query): Promise<MemoryStageHit[]> {
      try {
        if (visible.size === 0 || !query.trim()) return []
        const rows = await prisma.$queryRaw<MemoryStageHit[]>`
          SELECT path, seq, text,
                 ts_rank(to_tsvector('english', text), websearch_to_tsquery('english', ${query})) AS score
          FROM context_memories
          WHERE space_id = ${context.spaceId}
            AND owner_key = ${context.ownerKey}
            AND text <> ''
            AND (path, mtime) IN (${identity()})
            AND to_tsvector('english', text) @@ websearch_to_tsquery('english', ${query})
          ORDER BY score DESC
          LIMIT ${TOP_K}`
        return rows
      } catch (err) {
        logger.error('notes.search.memory_keyword_failed', { err })
        return []
      }
    },
  }
}
