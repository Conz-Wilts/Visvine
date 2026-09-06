// The full retrieval-embedding sweep: every stale note vector, every stale
// note's CHUNKS, and any source chunk stored without a vector (or on an old
// model). One implementation behind the nightly maintenance run
// (lib/notes/nightly.ts), the post-clean pass (lib/notes/cleanSchedule.ts) and
// the manual `pnpm db:embed` script.
//
// Both vector stages are lazy — lib/notes/vectorStage.ts embeds at most 100
// stale whole-note vectors per query — but chunks are NOT: chunking a note is
// several vectors, so it is done here, in bulk, off the request path, and a
// note edited since is simply ranked by BM25 and its whole-note vector until
// the next sweep (chunkStage matches (path, mtime), so stale chunks never
// serve). This sweep is the catch-up: after it, first searches are fast, old
// uploads are findable, and every paragraph of a long note has its own vector.
//
// Idempotent: a note whose cached mtime already matches is skipped, and chunks
// already carrying the current model are left alone — so overlapping runs and
// re-runs are harmless.
//
// A space may switch embedding OFF (the Console's Clean section,
// `context_clean_schedules.embed_enabled`). Off means off everywhere: this
// sweep skips the space's embedding half, the query-time catch-up in
// vectorStage stops too (contextService reads the same flag), and only the
// orphan prunes — which spend nothing — still run for it.

import prisma from '@/lib/prisma'
import type { Context } from '@/lib/notes/store'
import { getVault } from '@/lib/notes/vaultCache'
import { splitFrontmatter } from '@/lib/notes/shared/markdown'
import { embedTexts, embeddingsConfig } from '@/lib/notes/embeddings'
import { vectorLiteral } from '@/lib/notes/vectorStage'
import { chunkNote } from '@/lib/notes/shared/noteChunks'
import { logger } from '@/lib/logger'

// Matches vectorStage.EMBED_CHARS — the same text must produce the same vector.
const EMBED_CHARS = 6000
const BATCH = 32

export interface EmbedSweepResult {
  /** False when OPENROUTER_API_KEY is unset — nothing was embedded. */
  configured: boolean
  /** True when the one space asked for has embedding switched off. */
  disabled: boolean
  /** Whole-note vectors written. */
  notes: number
  /** Notes re-chunked, and the chunk vectors written for them. */
  chunkedNotes: number
  noteChunks: number
  /** Source (upload) chunks embedded. */
  chunks: number
  /** Note vectors and note chunks deleted because no live note sits at their path. */
  pruned: number
  /** Stale notes left for the next run when `maxNotes` capped this one. */
  remaining: number
  /** Spaces skipped because they switched embedding off (an all-space sweep). */
  skippedSpaces: number
}

export interface EmbedSweepOptions {
  /**
   * At most this many stale notes (vector + chunks) per run. The post-clean
   * pass sets it so a first sweep of a large space cannot hold the tick to the
   * runtime's ceiling; the nightly and `db:embed` leave it unbounded.
   */
  maxNotes?: number
}

/** Spaces whose admins switched embedding off. Absent row = on. */
async function embeddingDisabledSpaces(): Promise<Set<string>> {
  const rows = await prisma.contextCleanSchedule.findMany({
    where: { embedEnabled: false },
    select: { spaceId: true },
  })
  return new Set(rows.map((r) => r.spaceId))
}

/** Whether one space embeds at all — read by the query-time catch-up too. */
export async function embeddingEnabledFor(spaceId: string): Promise<boolean> {
  const row = await prisma.contextCleanSchedule.findUnique({
    where: { spaceId },
    select: { embedEnabled: true },
  })
  return row?.embedEnabled ?? true
}

/**
 * Embed every stale note (vector + chunks) and unembedded source chunk, for
 * one space or all. Returns counts; `configured: false` (and zero embedding
 * work) when no key is set.
 */
export async function embedSweep(spaceId?: string, opts: EmbedSweepOptions = {}): Promise<EmbedSweepResult> {
  // Pruning is not an embedding operation and must not be gated on a key or a
  // toggle: a space whose OPENROUTER_API_KEY was removed, or that switched
  // embedding off, still deletes notes, and its orphaned vectors would
  // otherwise be unreachable by any repair. Runs first so the staleness
  // comparison below never considers a row it is about to delete.
  const pruned = (await pruneOrphanEmbeddings(spaceId)) + (await pruneOrphanChunks(spaceId))

  const empty = (over: Partial<EmbedSweepResult>): EmbedSweepResult => ({
    configured: true,
    disabled: false,
    notes: 0,
    chunkedNotes: 0,
    noteChunks: 0,
    chunks: 0,
    pruned,
    remaining: 0,
    skippedSpaces: 0,
    ...over,
  })

  const config = embeddingsConfig()
  if (!config) return empty({ configured: false })

  const disabled = await embeddingDisabledSpaces()
  if (spaceId && disabled.has(spaceId)) return empty({ disabled: true })
  const where = spaceId ? { spaceId } : {}

  const contextRows = await prisma.contextNote.groupBy({
    by: ['spaceId', 'ownerKey'],
    where: { ...where, deletedAt: null },
  })
  const skippedSpaces = new Set<string>()
  const contexts: Context[] = []
  for (const b of contextRows) {
    if (disabled.has(b.spaceId)) skippedSpaces.add(b.spaceId)
    else contexts.push({ spaceId: b.spaceId, ownerKey: b.ownerKey })
  }

  let notes = 0
  let chunkedNotes = 0
  let noteChunks = 0
  let remaining = 0
  let budget = opts.maxNotes ?? Number.POSITIVE_INFINITY
  for (const context of contexts) {
    const { raws, metas } = await getVault(context)
    const bodyByPath = new Map(raws.map((r) => [r.path, splitFrontmatter(r.content).body]))

    // Staleness is judged per tier — a note embedded whole before chunks
    // existed still needs its chunks — and the cap bounds the union, so the
    // post-clean pass cannot hold the tick to the runtime's ceiling.
    const [cached, chunked] = await Promise.all([
      prisma.contextNoteEmbedding.findMany({
        where: { spaceId: context.spaceId, ownerKey: context.ownerKey, model: config.model },
        select: { path: true, mtime: true },
      }),
      prisma.contextNoteChunk.findMany({
        where: { spaceId: context.spaceId, ownerKey: context.ownerKey, model: config.model },
        select: { path: true, mtime: true },
        distinct: ['path'],
      }),
    ])
    const cachedMtime = new Map(cached.map((r) => [r.path, Number(r.mtime)]))
    const chunkedMtime = new Map(chunked.map((r) => [r.path, Number(r.mtime)]))
    let stale = metas
      .filter((m) => cachedMtime.get(m.path) !== m.mtime || chunkedMtime.get(m.path) !== m.mtime)
      .sort((a, b) => b.mtime - a.mtime)
    if (stale.length > budget) {
      remaining += stale.length - budget
      stale = stale.slice(0, budget)
    }
    budget -= stale.length

    // Whole-note vectors.
    const staleWhole = stale.filter((m) => cachedMtime.get(m.path) !== m.mtime)
    for (let i = 0; i < staleWhole.length; i += BATCH) {
      const batch = staleWhole.slice(i, i + BATCH)
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

    // Chunks: a note's rows are replaced wholesale inside one transaction, so a
    // shrunken note never leaves old seqs behind and a reader never sees half
    // a note's chunks.
    const toChunk = stale.filter((m) => chunkedMtime.get(m.path) !== m.mtime)
    // One embeddings call per BATCH of notes, not per note: a 700-note space
    // is a couple of dozen requests rather than seven hundred.
    for (let i = 0; i < toChunk.length; i += BATCH) {
      const batch = toChunk.slice(i, i + BATCH).map((m) => ({
        meta: m,
        chunks: chunkNote(m.title, bodyByPath.get(m.path) ?? '').chunks,
      }))
      let vectors: number[][]
      try {
        vectors = await embedTexts(batch.flatMap((b) => b.chunks.map((c) => c.embedText)))
      } catch (err) {
        // One batch failing must not end the sweep; its notes stay stale for
        // next time and their whole-note vectors (already written) serve.
        logger.warn('notes.embed.chunks_failed', { err, paths: batch.map((b) => b.meta.path) })
        continue
      }
      let offset = 0
      for (const { meta: m, chunks } of batch) {
        const own = vectors.slice(offset, offset + chunks.length)
        offset += chunks.length
        await prisma.$transaction([
          prisma.contextNoteChunk.deleteMany({
            where: { spaceId: context.spaceId, ownerKey: context.ownerKey, path: m.path },
          }),
          ...chunks.map(
            (c, j) => prisma.$executeRaw`
              INSERT INTO context_note_chunks (id, space_id, owner_key, path, seq, heading, text, mtime, model, embedding, updated_at)
              VALUES ((gen_random_uuid())::text, ${context.spaceId}, ${context.ownerKey}, ${m.path}, ${c.seq}, ${c.heading}, ${c.text}, ${BigInt(m.mtime)}, ${config.model}, ${vectorLiteral(own[j])}::vector, now())`,
          ),
        ])
        chunkedNotes += 1
        noteChunks += chunks.length
      }
    }
  }

  // Source chunks: anything not already on the current model, in id order so a
  // failure mid-run leaves a clean prefix and re-running resumes.
  const sourceWhere = spaceId ? { spaceId } : skippedSpaces.size ? { spaceId: { notIn: [...skippedSpaces] } } : {}
  const chunks = await prisma.contextSourceChunk.findMany({
    where: { ...sourceWhere, OR: [{ model: null }, { model: { not: config.model } }] },
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

  return empty({
    notes,
    chunkedNotes,
    noteChunks,
    chunks: chunks.length,
    remaining,
    skippedSpaces: skippedSpaces.size,
  })
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

/** The same reconcile for note chunks — keyed the same way, orphaned the same way. */
async function pruneOrphanChunks(spaceId?: string): Promise<number> {
  if (spaceId) {
    return prisma.$executeRaw`
      DELETE FROM context_note_chunks c
      WHERE c.space_id = ${spaceId}
        AND NOT EXISTS (
          SELECT 1 FROM context_notes n
          WHERE n.space_id = c.space_id
            AND n.owner_key = c.owner_key
            AND n.path = c.path
            AND n.deleted_at IS NULL
        )`
  }
  return prisma.$executeRaw`
    DELETE FROM context_note_chunks c
    WHERE NOT EXISTS (
      SELECT 1 FROM context_notes n
      WHERE n.space_id = c.space_id
        AND n.owner_key = c.owner_key
        AND n.path = c.path
        AND n.deleted_at IS NULL
    )`
}
