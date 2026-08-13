// The Context Source ingestion pipeline, run synchronously inside the upload
// request (serverless — no resident workers; the chunk caps in shared/chunking
// bound the cost: ≤300 chunks = ≤5 batched embedding calls). Flow: GCS upload →
// pending row → extract → chunk → embed → chunk rows → ready; any throw after
// the row exists lands it in 'failed' with the error, retryable via reingest.
// Embeddings unconfigured → text-only chunks and still 'ready' (list/read/BM25-
// free search paths work; only the vector stage skips them).

import { getStorage, RESOURCES_BUCKET, uploadResourceFile } from '@/lib/gcs'
import { type Brain } from '../store'
import { embedTexts, embeddingsConfig } from '../embeddings'
import { chunkSourceText } from '../shared/chunking'
import type { ContextSourceMeta, SourceKind } from '../shared/sourceTypes'
import * as sourceStore from '../sourceStore'
import { extractText } from './extract'

export interface IngestInput {
  path: string // sanitized brain-relative destination (never .md)
  name: string
  kind: SourceKind
  mimeType: string
  buffer: Buffer
  createdBy: string
}

function gcsObjectPath(brain: Brain, sourceId: string, name: string): string {
  return `context-sources/${brain.spaceId}/${brain.ownerKey}/${sourceId}/${name}`
}

// Like embeddings, original-file storage degrades to off when unconfigured
// (local dev): the extracted chunks still serve read/search, gcsPath stays ''
// (no download URL), and reingest reports the original as unavailable.
function gcsConfigured(): boolean {
  return Boolean(process.env.GCS_RESOURCES_BUCKET)
}

/** Extract → chunk → embed → replace chunks, updating the row's status. */
async function processSource(
  brain: Brain,
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
      { id: source.id, spaceId: brain.spaceId, ownerKey: brain.ownerKey, path: source.path },
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
  const meta = await sourceStore.getSource(brain, source.path)
  if (!meta) throw new Error('Source disappeared during ingestion')
  return meta
}

/** Upload + ingest a new source. Throws before any row exists (e.g. path taken). */
export async function ingestSource(brain: Brain, input: IngestInput): Promise<ContextSourceMeta> {
  // Row first (it owns the unique-path check), then the GCS object named by row id.
  const created = await sourceStore.createSourceRow(brain, {
    path: input.path,
    name: input.name,
    kind: input.kind,
    mimeType: input.mimeType,
    sizeBytes: input.buffer.length,
    gcsPath: '', // '' = original not stored (set after upload when configured)
    createdBy: input.createdBy,
  })
  if (gcsConfigured()) {
    // Best-effort, exactly like the unconfigured case: the extracted text is what
    // retrieval needs, so a storage failure (expired credentials, bucket
    // permissions) must not throw away an otherwise good ingest. gcsPath stays
    // '' — no download link, and reingest reports the original as unavailable.
    const gcsPath = gcsObjectPath(brain, created.id, input.name)
    try {
      await uploadResourceFile(gcsPath, input.buffer, input.mimeType)
      await sourceStore.updateSourceGcsPath(created.id, gcsPath)
    } catch (err) {
      console.error('[context-sources] original upload failed, indexing text only', err)
    }
  }
  // An uploaded file is content in the brain, not a node in the graph: it is
  // retrievable through the context surfaces and nothing else stands for it.
  return processSource(brain, { id: created.id, path: created.path, kind: input.kind }, input.buffer)
}

/** Re-run extract-onward from the stored GCS object (retry / embedding-model change). */
export async function reingestSource(brain: Brain, path: string): Promise<ContextSourceMeta | null> {
  const row = await sourceStore.findSource(brain, path)
  if (!row) return null
  if (!row.gcsPath || !gcsConfigured()) {
    await sourceStore.updateSourceStatus(row.id, {
      status: 'failed',
      error: 'The original file is not in storage — delete and re-upload it.',
    })
    return sourceStore.getSource(brain, path)
  }
  const [contents] = await getStorage().bucket(RESOURCES_BUCKET()).file(row.gcsPath).download()
  await sourceStore.updateSourceStatus(row.id, { status: 'pending', error: null })
  return processSource(brain, { id: row.id, path: row.path, kind: row.kind as SourceKind }, contents)
}
