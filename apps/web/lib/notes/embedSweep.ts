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
}

/**
 * Embed every stale note and unembedded source chunk, for one space or all.
 * Returns counts; `configured: false` (and zero work) when no key is set.
 */
export async function embedSweep(spaceId?: string): Promise<EmbedSweepResult> {
  const config = embeddingsConfig()
  if (!config) return { configured: false, notes: 0, chunks: 0 }
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
      for (let j = 0; j < batch.length; j++) {
        const literal = vectorLiteral(vectors[j])
        await prisma.$executeRaw`
          INSERT INTO context_note_embeddings (id, space_id, owner_key, path, model, mtime, embedding, updated_at)
          VALUES ((gen_random_uuid())::text, ${context.spaceId}, ${context.ownerKey}, ${batch[j].path}, ${config.model}, ${BigInt(batch[j].mtime)}, ${literal}::vector, now())
          ON CONFLICT (space_id, owner_key, path)
          DO UPDATE SET model = ${config.model}, mtime = ${BigInt(batch[j].mtime)}, embedding = ${literal}::vector, updated_at = now()`
      }
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
    for (let j = 0; j < batch.length; j++) {
      await prisma.$executeRaw`
        UPDATE context_source_chunks
        SET model = ${config.model}, embedding = ${vectorLiteral(vectors[j])}::vector
        WHERE id = ${batch[j].id}`
    }
  }

  return { configured: true, notes, chunks: chunks.length }
}
