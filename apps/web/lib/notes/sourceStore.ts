// DB store for Context Sources — the non-note counterpart of ./store.ts. A
// source row is keyed by the same brain `{ communityId, ownerKey }` + brain
// path as a note (so gate/lens predicates apply unchanged); its original file
// lives in GCS and its extracted text lives chunked in context_source_chunks.
// No trash and no revisions: a source is a mirror of an uploaded file, so
// delete is hard (row cascade + GCS object).

import prisma from '@/lib/prisma'
import { deleteResourceFile } from '@/lib/gcs'
import { sanitizePath, type Brain } from './store'
import { vectorLiteral } from './vectorStage'
import type { ContextSourceMeta, SourceKind, SourceStatus } from './shared/sourceTypes'

type SourceRow = {
  id: string
  path: string
  name: string
  kind: string
  mimeType: string
  sizeBytes: number
  gcsPath: string
  status: string
  error: string | null
  truncated: boolean
  textChars: number | null
  chunkCount: number
  createdBy: string
  updatedAt: Date
}

const META_SELECT = {
  id: true,
  path: true,
  name: true,
  kind: true,
  mimeType: true,
  sizeBytes: true,
  gcsPath: true,
  status: true,
  error: true,
  truncated: true,
  textChars: true,
  chunkCount: true,
  createdBy: true,
  updatedAt: true,
} as const

function toMeta(row: SourceRow): ContextSourceMeta {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    kind: row.kind as SourceKind,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status as SourceStatus,
    error: row.error ?? undefined,
    truncated: row.truncated,
    textChars: row.textChars ?? undefined,
    chunkCount: row.chunkCount,
    createdBy: row.createdBy,
    mtime: row.updatedAt.getTime(),
  }
}

export async function listSources(brain: Brain): Promise<ContextSourceMeta[]> {
  const rows = await prisma.contextSource.findMany({
    where: { communityId: brain.communityId, ownerKey: brain.ownerKey },
    select: META_SELECT,
    orderBy: { path: 'asc' },
  })
  return rows.map(toMeta)
}

export async function getSource(brain: Brain, path: string): Promise<ContextSourceMeta | null> {
  const row = await findSource(brain, path)
  return row ? toMeta(row) : null
}

/** The full row (incl. gcsPath) — internal to the ingest/read/delete paths. */
export async function findSource(brain: Brain, path: string): Promise<SourceRow | null> {
  return prisma.contextSource.findUnique({
    where: {
      source_identity: {
        communityId: brain.communityId,
        ownerKey: brain.ownerKey,
        path: sanitizePath(path),
      },
    },
    select: META_SELECT,
  })
}

export interface CreateSourceInput {
  path: string
  name: string
  kind: SourceKind
  mimeType: string
  sizeBytes: number
  gcsPath: string
  createdBy: string
}

/** Insert the pending row; refuses to overwrite an existing source at the path. */
export async function createSourceRow(brain: Brain, input: CreateSourceInput): Promise<ContextSourceMeta> {
  const p = sanitizePath(input.path)
  if (p.toLowerCase().endsWith('.md')) throw new Error(`Sources must not use the .md note namespace: ${p}`)
  const row = await prisma.contextSource.create({
    data: {
      communityId: brain.communityId,
      ownerKey: brain.ownerKey,
      ...input,
      path: p,
      status: 'pending',
    },
    select: META_SELECT,
  })
  return toMeta(row)
}

export async function updateSourceGcsPath(id: string, gcsPath: string): Promise<void> {
  await prisma.contextSource.update({ where: { id }, data: { gcsPath } })
}

export async function updateSourceStatus(
  id: string,
  data: {
    status: SourceStatus
    error?: string | null
    truncated?: boolean
    textChars?: number | null
    chunkCount?: number
  },
): Promise<void> {
  await prisma.contextSource.update({ where: { id }, data })
}

/** Hard-delete a source: chunk rows cascade, then the GCS object goes. */
export async function deleteSource(brain: Brain, path: string): Promise<boolean> {
  const row = await findSource(brain, path)
  if (!row) return false
  await prisma.contextSource.delete({ where: { id: row.id } })
  // gcsPath '' = the original was never stored (storage unconfigured at upload).
  if (row.gcsPath && process.env.GCS_RESOURCES_BUCKET) await deleteResourceFile(row.gcsPath)
  return true
}

/** Ordered chunk texts for a source — the extracted-text source of truth. */
export async function listChunkTexts(sourceId: string): Promise<string[]> {
  const rows = await prisma.contextSourceChunk.findMany({
    where: { sourceId },
    orderBy: { seq: 'asc' },
    select: { text: true },
  })
  return rows.map((r) => r.text)
}

/**
 * Replace a source's chunks wholesale (ingest/reingest). `vectors` runs parallel
 * to `chunks`; null entries (embeddings unconfigured/failed) store text-only
 * rows that list/read still serve — only the vector stage skips them.
 */
export async function replaceChunks(
  source: { id: string; communityId: string; ownerKey: string; path: string },
  chunks: string[],
  vectors: (number[] | null)[],
  model: string | null,
): Promise<void> {
  await prisma.contextSourceChunk.deleteMany({ where: { sourceId: source.id } })
  for (let seq = 0; seq < chunks.length; seq++) {
    const v = vectors[seq] ?? null
    if (v && model) {
      await prisma.$executeRaw`
        INSERT INTO context_source_chunks (id, source_id, community_id, owner_key, path, seq, text, model, embedding)
        VALUES ((gen_random_uuid())::text, ${source.id}, ${source.communityId}, ${source.ownerKey}, ${source.path}, ${seq}, ${chunks[seq]}, ${model}, ${vectorLiteral(v)}::vector)`
    } else {
      await prisma.contextSourceChunk.create({
        data: {
          sourceId: source.id,
          communityId: source.communityId,
          ownerKey: source.ownerKey,
          path: source.path,
          seq,
          text: chunks[seq],
          model: null,
        },
      })
    }
  }
}
