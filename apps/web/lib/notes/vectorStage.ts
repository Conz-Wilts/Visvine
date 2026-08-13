// The embeddings stage of the fused search stack, backed by pgvector
// (ContextNoteEmbedding). Whole-note vectors are cached per context path and
// invalidated by the note's updatedAt (mtime); stale notes are embedded lazily
// at query time, bounded per call. Cosine ranking runs in Postgres. The QUERY
// vector is embedded once by the caller (contextService.searchContext) and shared
// with the source-chunk stage. A null query vector (no key) or any failure
// returns [] and fusion degrades to keyword + context — recorded on the report
// so the caller can say so instead of returning a silently worse result.

import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import type { Context } from './store'
import type { VectorStage } from './shared/retrieval'
import { embedTexts, embeddingsConfig } from './embeddings'

// Whole-note embedding: notes are short by convention; per-section chunking is v2.
const EMBED_CHARS = 6000
// Bounds first-query latency after a bulk change; the rest embeds on later calls.
const MAX_EMBEDS_PER_CALL = 100
const TOP_K = 20
// Cosine scores cluster for unrelated notes; docs below this relative floor are
// noise and would otherwise leak into the RRF fusion on sparse queries.
const RELATIVE_FLOOR = 0.85
// …and a floor in absolute terms, because "85% of the best" is still noise when
// the best match is itself unrelated to the query.
const ABSOLUTE_FLOOR = 0.55

/** Collects why the semantic stages produced nothing, for the caller to report. */
export interface SemanticReport {
  error?: string
}

// Exported for the context-source chunk stage, which shares the pgvector SQL shape.
export function vectorLiteral(v: number[]): string {
  // Compact to 6 decimals — cosine is insensitive and the literal stays small.
  return `[${v.map((x) => Math.round(x * 1e6) / 1e6).join(',')}]`
}

/** Keep only rows that clear both the relative and the absolute cosine floor. */
export function aboveFloors<T extends { score: number }>(rows: T[]): T[] {
  const top = rows[0]?.score ?? 0
  return rows.filter((r) => r.score >= top * RELATIVE_FLOOR && r.score >= ABSOLUTE_FLOOR)
}

export function createVectorStage(
  context: Context,
  queryVector: number[] | null,
  report: SemanticReport = {},
): VectorStage {
  return {
    async rank(_query, docs) {
      try {
        const config = embeddingsConfig()
        if (!config || !queryVector || docs.length === 0) return []

        const cached = await prisma.contextNoteEmbedding.findMany({
          where: { spaceId: context.spaceId, ownerKey: context.ownerKey, model: config.model },
          select: { path: true, mtime: true },
        })
        const cachedMtime = new Map(cached.map((r) => [r.path, Number(r.mtime)]))
        const stale = docs
          .filter((d) => d.mtime !== undefined && cachedMtime.get(d.path) !== d.mtime)
          .slice(0, MAX_EMBEDS_PER_CALL)

        if (stale.length > 0) {
          const staleVectors = await embedTexts(
            stale.map((d) => `${d.title}\n${d.body}`.slice(0, EMBED_CHARS)),
          )
          for (let i = 0; i < stale.length; i++) {
            const d = stale[i]
            const literal = vectorLiteral(staleVectors[i])
            await prisma.$executeRaw`
              INSERT INTO context_note_embeddings (id, space_id, owner_key, path, model, mtime, embedding, updated_at)
              VALUES ((gen_random_uuid())::text, ${context.spaceId}, ${context.ownerKey}, ${d.path}, ${config.model}, ${BigInt(d.mtime!)}, ${literal}::vector, now())
              ON CONFLICT (space_id, owner_key, path)
              DO UPDATE SET model = ${config.model}, mtime = ${BigInt(d.mtime!)}, embedding = ${literal}::vector, updated_at = now()`
          }
        }

        const paths = docs.map((d) => d.path)
        const rows = await prisma.$queryRaw<{ path: string; score: number }[]>`
          SELECT path, 1 - (embedding <=> ${vectorLiteral(queryVector)}::vector) AS score
          FROM context_note_embeddings
          WHERE space_id = ${context.spaceId}
            AND owner_key = ${context.ownerKey}
            AND model = ${config.model}
            AND embedding IS NOT NULL
            AND path IN (${Prisma.join(paths)})
          ORDER BY score DESC
          LIMIT ${TOP_K}`

        return aboveFloors(rows)
      } catch (err) {
        // Any failure just removes this stage from fusion for the call.
        const message = err instanceof Error ? err.message : String(err)
        report.error ??= message
        console.error('[vector-stage]', message)
        return []
      }
    },
  }
}
