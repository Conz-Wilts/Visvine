// The note-chunk stage of the fused search — ranks the section-sized chunks of
// notes (lib/notes/shared/noteChunks.ts, written by lib/notes/embedSweep.ts)
// and hands each hit back keyed to its NOTE, so the fusion folds it onto the
// note it came from and the result carries the passage that matched. One
// half only: cosine over the chunk vectors. There is no keyword half because
// BM25 upstream already ranks the whole note's text; a second keyword stage
// over the same words would count one match twice.
//
// Only chunks of the CURRENT version of a visible note rank: the caller passes
// (path, mtime) of every note it may show, and the query matches both — chunks
// of an older save are stale and never served, and the note still ranks on
// its own through BM25 and the whole-note vector until the next sweep.

import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import type { Context } from './store'
import type { ChunkStage, ChunkStageHit } from './shared/retrieval'
import { embeddingsConfig } from './embeddings'
import { aboveFloors, vectorLiteral, type SemanticReport } from './vectorStage'
import { logger } from '@/lib/logger'

const TOP_K = 30

export function createChunkStage(
  context: Context,
  visible: ReadonlyMap<string, number>,
  queryVectors: ReadonlyMap<string, number[]>,
  report: SemanticReport = {},
): ChunkStage {
  const identity = () =>
    Prisma.join([...visible.entries()].map(([path, mtime]) => Prisma.sql`(${path}, ${BigInt(mtime)}::bigint)`))

  return {
    async rank(query): Promise<ChunkStageHit[]> {
      try {
        const config = embeddingsConfig()
        const queryVector = queryVectors.get(query)
        if (!config || !queryVector || visible.size === 0) return []
        const rows = await prisma.$queryRaw<ChunkStageHit[]>`
          SELECT path, seq, heading, text, 1 - (embedding <=> ${vectorLiteral(queryVector)}::vector) AS score
          FROM context_note_chunks
          WHERE space_id = ${context.spaceId}
            AND owner_key = ${context.ownerKey}
            AND model = ${config.model}
            AND embedding IS NOT NULL
            AND text <> ''
            AND (path, mtime) IN (${identity()})
          ORDER BY score DESC
          LIMIT ${TOP_K}`
        return aboveFloors(rows)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        report.error ??= message
        logger.error('notes.search.chunk_stage_failed', { err })
        return []
      }
    },
  }
}
