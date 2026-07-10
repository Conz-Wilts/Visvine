// The embeddings stage of the fused search stack — blackbird-brain's
// src/server/vectorStage.ts re-backed by pgvector (CommunityNoteEmbedding)
// instead of a JSON sidecar. Whole-note vectors are cached per brain path and
// invalidated by the note's updatedAt (mtime); stale notes are embedded lazily
// at query time, bounded per call. Cosine ranking runs in Postgres. Any failure
// (or no configured key) returns [] and fusion degrades to BM25 + graph.

import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import type { Brain } from './store'
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

function vectorLiteral(v: number[]): string {
  // Compact to 6 decimals — cosine is insensitive and the literal stays small.
  return `[${v.map((x) => Math.round(x * 1e6) / 1e6).join(',')}]`
}

export function createVectorStage(brain: Brain): VectorStage {
  return {
    async rank(query, docs) {
      try {
        const config = embeddingsConfig()
        if (!config || docs.length === 0) return []

        const cached = await prisma.communityNoteEmbedding.findMany({
          where: { communityId: brain.communityId, ownerKey: brain.ownerKey, model: config.model },
          select: { path: true, mtime: true },
        })
        const cachedMtime = new Map(cached.map((r) => [r.path, Number(r.mtime)]))
        const stale = docs
          .filter((d) => d.mtime !== undefined && cachedMtime.get(d.path) !== d.mtime)
          .slice(0, MAX_EMBEDS_PER_CALL)

        // One round-trip embeds the query AND any stale notes together.
        const [queryVector, ...staleVectors] = await embedTexts([
          query,
          ...stale.map((d) => `${d.title}\n${d.body}`.slice(0, EMBED_CHARS)),
        ])

        for (let i = 0; i < stale.length; i++) {
          const d = stale[i]
          const literal = vectorLiteral(staleVectors[i])
          await prisma.$executeRaw`
            INSERT INTO community_note_embeddings (id, community_id, owner_key, path, model, mtime, embedding, updated_at)
            VALUES ((gen_random_uuid())::text, ${brain.communityId}, ${brain.ownerKey}, ${d.path}, ${config.model}, ${BigInt(d.mtime!)}, ${literal}::vector, now())
            ON CONFLICT (community_id, owner_key, path)
            DO UPDATE SET model = ${config.model}, mtime = ${BigInt(d.mtime!)}, embedding = ${literal}::vector, updated_at = now()`
        }

        const paths = docs.map((d) => d.path)
        const rows = await prisma.$queryRaw<{ path: string; score: number }[]>`
          SELECT path, 1 - (embedding <=> ${vectorLiteral(queryVector)}::vector) AS score
          FROM community_note_embeddings
          WHERE community_id = ${brain.communityId}
            AND owner_key = ${brain.ownerKey}
            AND model = ${config.model}
            AND embedding IS NOT NULL
            AND path IN (${Prisma.join(paths)})
          ORDER BY score DESC
          LIMIT ${TOP_K}`

        const top = rows[0]?.score ?? 0
        return rows.filter((r) => r.score >= top * RELATIVE_FLOOR)
      } catch (err) {
        // Any failure just removes this stage from fusion for the call.
        console.error('[vector-stage]', err instanceof Error ? err.message : String(err))
        return []
      }
    },
  }
}

/** Drop cached vectors for paths that no longer exist live (rename/delete hygiene). */
export async function pruneEmbeddings(brain: Brain, livePaths: string[]): Promise<void> {
  await prisma.communityNoteEmbedding.deleteMany({
    where: {
      communityId: brain.communityId,
      ownerKey: brain.ownerKey,
      ...(livePaths.length ? { path: { notIn: livePaths } } : {}),
    },
  })
}
