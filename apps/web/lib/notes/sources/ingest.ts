// The Context Source ingestion pipeline, run synchronously inside the upload
// request (serverless — no resident workers; the chunk caps in shared/chunking
// bound the cost: ≤300 chunks = ≤5 batched embedding calls). Flow: GCS upload →
// pending row → extract → chunk → embed → chunk rows → ready; any throw after
// the row exists lands it in 'failed' with the error, retryable via reingest.
// Embeddings unconfigured → text-only chunks and still 'ready' (list/read/BM25-
// free search paths work; only the vector stage skips them).

import { downloadResourceFile, uploadResourceFile } from '@/lib/gcs'
import { contextSourceObjectPath } from '@/lib/storage/objectPaths'
import { type Context } from '../store'
import { embedTexts, embeddingsConfig } from '../embeddings'
import { chunkSourceText } from '../shared/chunking'
import type { ContextSourceMeta, SourceKind } from '../shared/sourceTypes'
import * as sourceStore from '../sourceStore'
import { extractText } from './extract'
import { logger } from '@/lib/logger'

export interface IngestInput {
  path: string // sanitized context-relative destination (never .md)
  name: string
  kind: SourceKind
  mimeType: string
  buffer: Buffer
  createdBy: string
  /**
   * Whether this source OWNS the original bytes in GCS (default true).
   *
   * False when the caller already stored them and keeps the pointer — the Drive
   * (lib/resources/service.ts) uploads once and holds `Resource.gcsPath`, so
   * re-uploading here would double every file's storage, and `deleteSource`
   * deleting "its" object would break the Drive's download link. The source is
   * then exactly what it should be: the chunked PROJECTION of bytes somebody
   * else owns. gcsPath stays '' — its existing meaning of "the original is not
   * mine to serve" — and the owner provides its own re-index path.
   */
  storeOriginal?: boolean
}

// Built through lib/storage/objectPaths.ts, which is the only place any object
// path in this app is constructed — that is what lets a space or account delete
// express "these bytes were theirs" as a prefix and be provably right about it.
function gcsObjectPath(context: Context, sourceId: string, name: string): string {
  return contextSourceObjectPath(context.spaceId, context.ownerKey, sourceId, name)
}

// Like embeddings, original-file storage degrades to off when unconfigured
// (local dev): the extracted chunks still serve read/search, gcsPath stays ''
// (no download URL), and reingest reports the original as unavailable.
function gcsConfigured(): boolean {
  return Boolean(process.env.GCS_RESOURCES_BUCKET)
}

/** Extract → chunk → embed → replace chunks, updating the row's status. */
async function processSource(
  context: Context,
  source: { id: string; path: string; kind: SourceKind },
  buffer: Buffer,
): Promise<ContextSourceMeta> {
  try {
    const text = await extractText(buffer, source.kind)
    const { chunks, truncated, textChars } = chunkSourceText(text, source.kind)

    const config = embeddingsConfig()
    let vectors: (number[] | null)[] = chunks.map(() => null)
    if (config && chunks.length) {
      try {
        vectors = await embedTexts(chunks)
      } catch {
        // Text-only chunks still serve read/list; reingest can add vectors later.
        vectors = chunks.map(() => null)
      }
    }

    await sourceStore.replaceChunks(
      { id: source.id, spaceId: context.spaceId, ownerKey: context.ownerKey, path: source.path },
      chunks,
      vectors,
      config?.model ?? null,
    )
    await sourceStore.updateSourceStatus(source.id, {
      status: 'ready',
      error: null,
      truncated,
      textChars,
      chunkCount: chunks.length,
    })
  } catch (err) {
    await sourceStore.updateSourceStatus(source.id, {
      status: 'failed',
      error: err instanceof Error ? err.message : 'Ingestion failed',
    })
  }
  const meta = await sourceStore.getSource(context, source.path)
  if (!meta) throw new Error('Source disappeared during ingestion')
  return meta
}

/** Upload + ingest a new source. Throws before any row exists (e.g. path taken). */
export async function ingestSource(context: Context, input: IngestInput): Promise<ContextSourceMeta> {
  // Row first (it owns the unique-path check), then the GCS object named by row id.
  const created = await sourceStore.createSourceRow(context, {
    path: input.path,
    name: input.name,
    kind: input.kind,
    mimeType: input.mimeType,
    sizeBytes: input.buffer.length,
    gcsPath: '', // '' = original not stored (set after upload when configured)
    createdBy: input.createdBy,
  })
  if (input.storeOriginal !== false && gcsConfigured()) {
    // Best-effort, exactly like the unconfigured case: the extracted text is what
    // retrieval needs, so a storage failure (expired credentials, bucket
    // permissions) must not throw away an otherwise good ingest. gcsPath stays
    // '' — no download link, and reingest reports the original as unavailable.
    const gcsPath = gcsObjectPath(context, created.id, input.name)
    try {
      await uploadResourceFile(gcsPath, input.buffer, input.mimeType)
      await sourceStore.updateSourceGcsPath(created.id, gcsPath)
    } catch (err) {
      logger.error('notes.sources.upload_failed', { err, path: created.path })
    }
  }
  // An uploaded file is content in the context, not a node in the graph: it is
  // retrievable through the context surfaces and nothing else stands for it.
  return processSource(context, { id: created.id, path: created.path, kind: input.kind }, input.buffer)
}

/**
 * Re-run extract-onward from bytes the CALLER holds, for a source whose original
 * it does not own (`storeOriginal: false`). The Drive's re-index uses this: it
 * downloads from `Resource.gcsPath` and hands the buffer over, which is the same
 * retry `reingestSource` performs for sources that own their object.
 */
export async function reingestSourceFrom(
  context: Context,
  path: string,
  buffer: Buffer,
): Promise<ContextSourceMeta | null> {
  const row = await sourceStore.findSource(context, path)
  if (!row) return null
  await sourceStore.updateSourceStatus(row.id, { status: 'pending', error: null })
  return processSource(context, { id: row.id, path: row.path, kind: row.kind as SourceKind }, buffer)
}

/** Re-run extract-onward from the stored GCS object (retry / embedding-model change). */
export async function reingestSource(context: Context, path: string): Promise<ContextSourceMeta | null> {
  const row = await sourceStore.findSource(context, path)
  if (!row) return null
  if (!row.gcsPath || !gcsConfigured()) {
    await sourceStore.updateSourceStatus(row.id, {
      status: 'failed',
      error: 'The original file is not in storage — delete and re-upload it.',
    })
    return sourceStore.getSource(context, path)
  }
  const contents = await downloadResourceFile(row.gcsPath)
  await sourceStore.updateSourceStatus(row.id, { status: 'pending', error: null })
  return processSource(context, { id: row.id, path: row.path, kind: row.kind as SourceKind }, contents)
}
