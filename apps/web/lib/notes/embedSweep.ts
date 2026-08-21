// The full retrieval-embedding sweep: every stale note vector, and any source
// chunk stored without one (or on an old model). Extracted from
// scripts/embed-context.ts so the nightly maintenance run (lib/notes/nightly.ts)
// and the manual `pnpm db:embed` script share one implementation.
//
// Both vector stages are lazy — lib/notes/vectorStage.ts embeds at most 100
// stale notes per query, and lib/notes/sources/ingest.ts stores chunks with
// `model = null` when embedding fails or no key was configured at upload time.
// This sweep is the catch-up: after it, first searches are fast and old uploads
// are findable.
//
// Idempotent: a note whose cached mtime already matches is skipped, and chunks
// already carrying the current model are left alone — so overlapping runs and
// re-runs are harmless.

import prisma from '@/lib/prisma'
import type { Context } from '@/lib/notes/store'
import { getVault } from '@/lib/notes/vaultCache'
import { splitFrontmatter } from '@/lib/notes/shared/markdown'
import { embedTexts, embeddingsConfig } from '@/lib/notes/embeddings'
import { vectorLiteral } from '@/lib/notes/vectorStage'

// Matches vectorStage.EMBED_CHARS — the same text must produce the same vector.
const EMBED_CHARS = 6000
const BATCH = 32

export interface EmbedSweepResult {
  /** False when OPENAI_API_KEY is unset — nothing was embedded. */
  configured: boolean
  notes: number
  chunks: number
  /** Vectors deleted because no live note sits at their path any more. */
  pruned: number
}

/**
 * Embed every stale note and unembedded source chunk, for one space or all.
 * Returns counts; `configured: false` (and zero work) when no key is set.
 */
export async function embedSweep(spaceId?: string): Promise<EmbedSweepResult> {
  // Pruning is not an embedding operation and must not be gated on a key: a
  // space whose OPENAI_API_KEY was removed still deletes notes, and its orphaned
  // vectors would otherwise be unreachable by any repair. Runs first so the
  // staleness comparison below never considers a row it is about to delete.
  const pruned = await pruneOrphanEmbeddings(spaceId)

  const config = embeddingsConfig()
  if (!config) return { configured: false, notes: 0, chunks: 0, pruned }
  const where = spaceId ? { spaceId } : {}

  const contextRows = await prisma.contextNote.groupBy({
    by: ['spaceId', 'ownerKey'],
    where: { ...where, deletedAt: null },
  })
  const contexts: Context[] = contextRows.map((b) => ({
    spaceId: b.spaceId,
    ownerKey: b.ownerKey,
  }))

  let notes = 0
  for (const context of contexts) {
    const { raws, metas } = await getVault(context)
    const bodyByPath = new Map(raws.map((r) => [r.path, splitFrontmatter(r.content).body]))

    const cached = await prisma.contextNoteEmbedding.findMany({
      where: { spaceId: context.spaceId, ownerKey: context.ownerKey, model: config.model },
      select: { path: true, mtime: true },
    })
    const cachedMtime = new Map(cached.map((r) => [r.path, Number(r.mtime)]))
    const stale = metas.filter((m) => cachedMtime.get(m.path) !== m.mtime)

    for (let i = 0; i < stale.length; i += BATCH) {
      const batch = stale.slice(i, i + BATCH)
      const vectors = await embedTexts(
        batch.map((m) => `${m.title}\n${bodyByPath.get(m.path) ?? ''}`.slice(0, EMBED_CHARS)),
      )
      await Promise.all(
        batch.map((m, j) => {
          const literal = vectorLiteral(vectors[j])
          return prisma.$executeRaw`
            INSERT INTO context_note_embeddings (id, space_id, owner_key, path, model, mtime, embedding, updated_at)
            VALUES ((gen_random_uuid())::text, ${context.spaceId}, ${context.ownerKey}, ${m.path}, ${config.model}, ${BigInt(m.mtime)}, ${literal}::vector, now())
            ON CONFLICT (space_id, owner_key, path)
            DO UPDATE SET model = ${config.model}, mtime = ${BigInt(m.mtime)}, embedding = ${literal}::vector, updated_at = now()`
        }),
      )
      notes += batch.length
    }
  }

  // Source chunks: anything not already on the current model, in id order so a
  // failure mid-run leaves a clean prefix and re-running resumes.
  const chunks = await prisma.contextSourceChunk.findMany({
    where: { ...where, OR: [{ model: null }, { model: { not: config.model } }] },
    select: { id: true, text: true },
    orderBy: { id: 'asc' },
  })
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH)
    const vectors = await embedTexts(batch.map((c) => c.text))
    await Promise.all(
      batch.map(
        (c, j) => prisma.$executeRaw`
          UPDATE context_source_chunks
          SET model = ${config.model}, embedding = ${vectorLiteral(vectors[j])}::vector
          WHERE id = ${c.id}`,
      ),
    )
  }

  return { configured: true, notes, chunks: chunks.length, pruned }
}

/**
 * Delete vectors whose note is gone — the reconciling half of the lifecycle
 * whose eager half lives in lib/notes/projections.ts#dropEmbedding.
 *
 * `context_note_embeddings` cannot carry a foreign key to `context_notes`: a
 * note's identity is (space_id, owner_key, path), a unique constraint rather
 * than the primary key, and the path moves on rename. So the row's lifecycle is
 * code's responsibility, and code that runs once per event can be missed — a
 * projection that failed all eight of its attempts, a bulk path that never
 * enqueued one, a row that predates the eager delete existing at all. This is
 * what makes the miss temporary.
 *
 * Written as one statement so the whole comparison happens in Postgres; loading
 * both sides into Node to diff them would be the same query with extra steps and
 * a memory ceiling.
 */
async function pruneOrphanEmbeddings(spaceId?: string): Promise<number> {
  if (spaceId) {
    return prisma.$executeRaw`
      DELETE FROM context_note_embeddings e
      WHERE e.space_id = ${spaceId}
        AND NOT EXISTS (
          SELECT 1 FROM context_notes n
          WHERE n.space_id = e.space_id
            AND n.owner_key = e.owner_key
            AND n.path = e.path
            AND n.deleted_at IS NULL
        )`
  }
  return prisma.$executeRaw`
    DELETE FROM context_note_embeddings e
    WHERE NOT EXISTS (
      SELECT 1 FROM context_notes n
      WHERE n.space_id = e.space_id
        AND n.owner_key = e.owner_key
        AND n.path = e.path
        AND n.deleted_at IS NULL
    )`
}
