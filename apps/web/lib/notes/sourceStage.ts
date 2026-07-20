// The context-source stage of the fused search — the chunk-level sibling of
// vectorStage.ts. Chunks are embedded at ingest time (no lazy re-embed here;
// stale-model chunks simply don't rank until reingest), so the stage is one
// query embed + one cosine ranking in Postgres over the caller's VISIBLE source
// paths. Any failure (or no configured key) returns [] and fusion proceeds
// without sources. Note: when both this and the note vector stage run, the
// query is embedded twice — acceptable in v1, unify later.

import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import type { Brain } from './store'
import type { SourceStageHit } from './shared/retrieval'
import { embedTexts, embeddingsConfig } from './embeddings'
import { vectorLiteral } from './vectorStage'

const TOP_K = 20
// Same relative floor as the note vector stage — keeps noise out of RRF.
const RELATIVE_FLOOR = 0.85
const SNIPPET_CHARS = 240

export function createSourceStage(brain: Brain, visiblePaths: string[]) {
  return {
    async rank(query: string): Promise<SourceStageHit[]> {
      try {
        const config = embeddingsConfig()
        if (!config || visiblePaths.length === 0) return []

        const [queryVector] = await embedTexts([query])
        const rows = await prisma.$queryRaw<
          { path: string; seq: number; text: string; score: number }[]
        >`
          SELECT path, seq, text, 1 - (embedding <=> ${vectorLiteral(queryVector)}::vector) AS score
          FROM context_source_chunks
          WHERE community_id = ${brain.communityId}
            AND owner_key = ${brain.ownerKey}
            AND model = ${config.model}
            AND embedding IS NOT NULL
            AND path IN (${Prisma.join(visiblePaths)})
          ORDER BY score DESC
          LIMIT ${TOP_K}`

        const top = rows[0]?.score ?? 0
        return rows
          .filter((r) => r.score >= top * RELATIVE_FLOOR)
          .map((r) => ({
            path: r.path,
            seq: r.seq,
            snippet: r.text.slice(0, SNIPPET_CHARS),
            score: r.score,
          }))
      } catch (err) {
        console.error('[source-stage]', err instanceof Error ? err.message : String(err))
        return []
      }
    },
  }
}
