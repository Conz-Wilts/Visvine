/**
 * The Drive: a space's object storage, and the one path from uploaded bytes to
 * something a model can search.
 *
 * The philosophy the feature was always reaching for — store a document, give it
 * a context, run it through a RAG pipeline, keep the chunks in Postgres so
 * retrieval is a query and not a scan — is exactly what `context_sources` does
 * for files attached to a note. The Drive used to stop at "bytes in a bucket,
 * row in a table", so the product carried two half-built file systems and users
 * uploaded into the weaker one. This module is the join: one upload, one GCS
 * object, one `Resource` record, and a `ContextSource` beside it holding the
 * extracted chunks that put the file in `search_context` for members, MCP
 * clients and agents alike.
 *
 * Three rules the old two-step upload broke, restated here because they are the
 * whole reason this is a service and not two route handlers:
 *
 * 1. **The server mints the object path.** It used to be posted by the browser
 *    and handed straight to the signed-URL minter, so a crafted create could
 *    name any object in the shared bucket — including another space's
 *    context-source originals — and be issued a download URL for it. A client
 *    never names an object here.
 * 2. **A URL is not an identifier.** `gcsPath` is stored; the download URL is
 *    signed fresh per read and never persisted.
 * 3. **The Resource owns the bytes.** The ContextSource beside it is created
 *    with `storeOriginal: false`, so it is purely the chunked projection of this
 *    row and deleting it can never take the Drive's file with it.
 */
import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import {
  deleteResourceFile,
  downloadResourceFile,
  getSignedUrl,
  RESOURCES_BUCKET,
  uploadResourceFile,
} from '@/lib/gcs'
import { resourceObjectPath } from '@/lib/storage/objectPaths'
import { isFeatureAdminOnly } from '@/lib/featureAccess'
import { readSpaceConfig } from '@/lib/spaces/spaceConfig'
import { setFolderRestricted } from '@/lib/notes/access'
import { ingestSource, reingestSourceFrom } from '@/lib/notes/sources/ingest'
import * as sourceStore from '@/lib/notes/sourceStore'
import { SHARED_OWNER_KEY, type Context } from '@/lib/notes/store'
import { normalizeSourcePath, sourceKindOf } from '@/lib/notes/shared/sourceTypes'
import { requireFolderInSpace } from '@/lib/resources/folders'
import { linkFileNode, removeFileNode, requireResourceNode } from '@/lib/resources/node'

/** Per-file ceiling. Buffered whole before sharp runs, so this is a memory bound. */
export const MAX_RESOURCE_BYTES = 25 * 1024 * 1024

/** The context folder a space's Drive files are indexed under. */
const DRIVE_FOLDER = 'resources'

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.tiff', '.heic', '.heif', '.ico',
])

/** Where a file got to in the RAG pipeline. Surfaced in the Drive so "why can't
 *  the AI see my file" has a visible answer instead of silence. */
type IndexState = 'pending' | 'indexed' | 'unsupported' | 'failed'

export interface DriveFile {
  id: string
  spaceId: string
  name: string
  fileType: string
  fileUrl: string | null
  fileSize: number | null
  uploadedBy: string
  sourcePath: string | null
  indexState: IndexState
  indexError: string | null
  /** Chunks this file contributed to retrieval — 0 until it is indexed. */
  chunkCount: number
  /** The Drive folder it sits in; null is the root. */
  folderId: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

/** The display bucket the Drive UI groups by. Derived, never client-supplied. */
function fileTypeOf(ext: string, isImage: boolean): string {
  if (isImage) return 'image'
  if (ext === '.xlsx' || ext === '.xls') return 'xlsx'
  if (ext === '.csv') return 'csv'
  if (ext === '.docx' || ext === '.doc') return 'docx'
  if (ext === '.pdf') return 'pdf'
  if (ext === '.md' || ext === '.markdown') return 'markdown'
  if (ext === '.json') return 'json'
  if (ext === '.txt') return 'text'
  return ext.replace('.', '') || 'file'
}

function contextOf(spaceId: string): Context {
  return { spaceId, ownerKey: SHARED_OWNER_KEY }
}

/**
 * A free context path for this file under `resources/`, suffixing on collision.
 *
 * The source namespace is keyed by path and two people uploading `report.csv`
 * must not fight over one row — the second becomes `report-2.csv`. `.md` is
 * rewritten to `.markdown` by normalizeSourcePath so a source can never collide
 * with the note namespace.
 */
async function freeSourcePath(context: Context, filename: string): Promise<string> {
  const safe = normalizeSourcePath(filename.replace(/[/\\]/g, '_').trim() || 'file')
  const dot = safe.lastIndexOf('.')
  const stem = dot > 0 ? safe.slice(0, dot) : safe
  const ext = dot > 0 ? safe.slice(dot) : ''
  for (let n = 0; n < 50; n++) {
    const candidate = `${DRIVE_FOLDER}/${stem}${n ? `-${n + 1}` : ''}${ext}`
    if (!(await sourceStore.findSource(context, candidate))) return candidate
  }
  return `${DRIVE_FOLDER}/${stem}-${randomUUID().slice(0, 8)}${ext}`
}

/**
 * Keep the Drive's context folder as private as the Drive itself.
 *
 * The two surfaces have different gates — the files are gated by the
 * `directory` feature key that owns the page it sits on, the indexed contents
 * by the context visibility lens —
 * so a space that restricted its directory to admins would otherwise have handed
 * every member the contents through search. Restricting the folder cuts grant
 * inheritance at its boundary, which is the context layer's own way of saying
 * the same thing. Idempotent, and never un-restricts: widening access is always
 * a deliberate admin act, never a side effect of an upload.
 */
async function alignFolderPrivacy(spaceId: string): Promise<void> {
  try {
    const config = await readSpaceConfig(spaceId)
    if (!config || !isFeatureAdminOnly(config.featureConfig, 'directory')) return
    const existing = await prisma.contextFolder.findUnique({
      where: { folder_identity: { spaceId, ownerKey: SHARED_OWNER_KEY, path: DRIVE_FOLDER } },
      select: { restricted: true },
    })
    if (existing?.restricted) return
    await setFolderRestricted(spaceId, DRIVE_FOLDER, true, { userId: 'system', name: 'Drive' })
  } catch (err) {
    logger.error('resources.folderPrivacy.failed', { spaceId, err })
  }
}

export interface UploadInput {
  spaceId: string
  filename: string
  mimeType: string
  buffer: Buffer
  uploadedBy: string
  /** The folder to land in; null (the default) is the root. */
  folderId?: string | null
  /**
   * The resource node this file is the content of. Omitted, the upload gets a
   * node of its own, named after the file.
   */
  nodeId?: string | null
  /**
   * The channel the file was dropped into. Such a file is the channel's and
   * gets NO resource node — a directory of chat screenshots is noise; it is
   * listed in Resources to the channel's members instead.
   */
  conversationId?: string | null
}

export type UploadedFile = DriveFile & { nodeId: string | null }

/**
 * Store a file, index it, and give it its Resource: the node whose page shows
 * it. A file the node already had is replaced — a Resource has one file.
 */
export async function uploadResource(input: UploadInput): Promise<UploadedFile> {
  if (input.nodeId) await requireResourceNode(input.spaceId, input.nodeId)
  const file = await storeResource(input)
  if (input.conversationId) return { ...file, nodeId: null }
  const { nodeId, replacedFileId } = await linkFileNode(file, input.nodeId ?? null)
  if (replacedFileId && replacedFileId !== file.id) await deleteResource(replacedFileId)
  return { ...file, nodeId }
}

/**
 * Store a file and index it. The whole Drive write path, in one call, so the
 * object path, the record and the chunks cannot disagree.
 *
 * Indexing runs inline and is deliberately NOT allowed to fail the upload: the
 * file is safely stored either way, and `indexState`/`indexError` carry the
 * outcome to the UI, where "Re-index" retries it. That ordering is the point —
 * losing an upload because an embedding call timed out would be a far worse
 * failure than an un-indexed file.
 */
async function storeResource(input: UploadInput): Promise<DriveFile> {
  const { spaceId, buffer, uploadedBy } = input
  const folderId = input.folderId ?? null
  await requireFolderInSpace(spaceId, folderId)
  if (buffer.length > MAX_RESOURCE_BYTES) {
    throw new Error(`File must be less than ${Math.floor(MAX_RESOURCE_BYTES / 1024 / 1024)}MB`)
  }

  const originalName = (input.filename || 'file').split(/[/\\]/).pop() || 'file'
  const ext = extname(originalName).toLowerCase()
  const isImage = IMAGE_EXTS.has(ext)

  // Images are re-encoded to webp (bounded, stripped of EXIF); everything else
  // is stored byte-for-byte, because the Drive is storage and not an editor.
  let bytes = buffer
  let mimeType = input.mimeType || 'application/octet-stream'
  let storedName = originalName
  if (isImage) {
    const sharp = (await import('sharp')).default
    bytes = await sharp(buffer)
      .rotate()
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer()
    mimeType = 'image/webp'
    storedName = `${originalName.slice(0, originalName.length - ext.length)}.webp`
  }

  // Server-minted, always. The uuid segment is what makes two files of the same
  // name distinct objects, and what stops a guessed path resolving to anything.
  const uuid = randomUUID()
  const gcsPath = resourceObjectPath(spaceId, uuid, storedName)
  await uploadResourceFile(gcsPath, bytes, mimeType)

  const kind = isImage ? null : sourceKindOf(storedName)
  const resource = await prisma.resource.create({
    data: {
      spaceId,
      name: originalName,
      fileType: fileTypeOf(ext, isImage),
      gcsPath,
      fileSize: bytes.length,
      uploadedBy,
      folderId,
      conversationId: input.conversationId ?? null,
      indexState: kind ? 'pending' : 'unsupported',
      indexError: kind
        ? null
        : isImage
          ? 'Images carry no text to index.'
          : `No text extractor for ${ext || 'this file type'} yet.`,
      metadata: { originalFilename: originalName, mimeType },
    },
  })

  if (!kind) return toDriveFile(resource, 0)

  const context = contextOf(spaceId)
  await alignFolderPrivacy(spaceId)
  try {
    const sourcePath = await freeSourcePath(context, storedName)
    const meta = await ingestSource(context, {
      path: sourcePath,
      name: originalName,
      kind,
      mimeType,
      buffer: bytes,
      createdBy: uploadedBy,
      // The Resource owns the object; this source is only its chunked projection.
      storeOriginal: false,
    })
    const updated = await prisma.resource.update({
      where: { id: resource.id },
      data: {
        sourcePath: meta.path,
        indexState: meta.status === 'ready' ? 'indexed' : 'failed',
        indexError: meta.error ?? null,
      },
    })
    return toDriveFile(updated, meta.chunkCount)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Indexing failed'
    logger.error('resources.index.failed', { spaceId, resourceId: resource.id, err: message })
    const updated = await prisma.resource.update({
      where: { id: resource.id },
      data: { indexState: 'failed', indexError: message.slice(0, 500) },
    })
    return toDriveFile(updated, 0)
  }
}

/**
 * Re-run extraction, chunking and embedding for one stored file.
 *
 * The repair path for everything that can leave a file un-indexed: an upload
 * that raced a bad embedding key, a file stored before the pipeline existed
 * (every pre-migration row is `pending` for exactly that reason), or a change of
 * embedding model. Bytes come back from the Drive's own object, since the source
 * does not own one.
 */
export async function reindexResource(resourceId: string): Promise<DriveFile | null> {
  const resource = await prisma.resource.findUnique({ where: { id: resourceId } })
  if (!resource) return null
  if (!resource.gcsPath || !process.env.GCS_RESOURCES_BUCKET) {
    const updated = await prisma.resource.update({
      where: { id: resource.id },
      data: { indexState: 'failed', indexError: 'The original file is not in storage — re-upload it.' },
    })
    return toDriveFile(updated, 0)
  }

  const kind = resource.fileType === 'image' ? null : sourceKindOf(resource.name)
  if (!kind) {
    const updated = await prisma.resource.update({
      where: { id: resource.id },
      data: { indexState: 'unsupported', indexError: 'No text extractor for this file type yet.' },
    })
    return toDriveFile(updated, 0)
  }

  const context = contextOf(resource.spaceId)
  const bytes = await downloadResourceFile(resource.gcsPath)
  await alignFolderPrivacy(resource.spaceId)

  // Reuse the existing source row when there is one, so a re-index replaces this
  // file's chunks rather than accumulating a second copy of them in retrieval.
  const existing = resource.sourcePath ? await sourceStore.findSource(context, resource.sourcePath) : null
  const meta = existing
    ? await reingestSourceFrom(context, resource.sourcePath!, bytes)
    : await ingestSource(context, {
        path: await freeSourcePath(context, resource.name),
        name: resource.name,
        kind,
        mimeType: (resource.metadata as Record<string, unknown> | null)?.mimeType as string ?? 'application/octet-stream',
        buffer: bytes,
        createdBy: resource.uploadedBy,
        storeOriginal: false,
      })

  const updated = await prisma.resource.update({
    where: { id: resource.id },
    data: {
      sourcePath: meta?.path ?? resource.sourcePath,
      indexState: meta?.status === 'ready' ? 'indexed' : 'failed',
      indexError: meta?.error ?? null,
    },
  })
  return toDriveFile(updated, meta?.chunkCount ?? 0)
}

/** Delete a file: its chunks, its record, and last the bytes it owns. */
export async function deleteResource(resourceId: string): Promise<boolean> {
  const resource = await prisma.resource.findUnique({ where: { id: resourceId } })
  if (!resource) return false

  if (resource.sourcePath) {
    // Drops the chunk rows. The object is untouched — this source never owned it.
    await sourceStore
      .deleteSource(contextOf(resource.spaceId), resource.sourcePath)
      .catch((err) => logger.error('resources.deleteSource.failed', { resourceId, err }))
  }
  await prisma.resource.delete({ where: { id: resource.id } })
  await removeFileNode(resource.spaceId, resource.id)

  // Last, and best-effort: an orphaned object costs storage, an orphaned record
  // costs a broken page.
  if (resource.gcsPath) {
    await deleteResourceFile(resource.gcsPath).catch((err) =>
      logger.error('resources.deleteObject.failed', { resourceId, err }),
    )
  }
  return true
}

type ResourceRow = {
  id: string
  spaceId: string
  name: string
  fileType: string
  fileSize: number | null
  uploadedBy: string
  sourcePath: string | null
  indexState: string
  indexError: string | null
  folderId: string | null
  metadata: unknown
  createdAt: Date
}

function toDriveFile(row: ResourceRow, chunkCount: number, fileUrl?: string | null): DriveFile {
  return {
    id: row.id,
    spaceId: row.spaceId,
    name: row.name,
    fileType: row.fileType,
    fileUrl: fileUrl ?? null,
    fileSize: row.fileSize,
    uploadedBy: row.uploadedBy,
    sourcePath: row.sourcePath,
    indexState: row.indexState as IndexState,
    indexError: row.indexError,
    chunkCount,
    folderId: row.folderId,
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * A space's Drive, newest first, each row carrying a freshly-signed download URL
 * and its indexing state.
 *
 * The URL is minted per read and never stored (getSignedUrl memoizes while it is
 * still valid, so a list of 40 files is not 40 signing round-trips). Chunk counts
 * come from the sources in one query rather than per row.
 */
export async function listResources(spaceId: string): Promise<DriveFile[]> {
  const context = contextOf(spaceId)
  const [rows, sources] = await Promise.all([
    prisma.resource.findMany({ where: { spaceId }, orderBy: { createdAt: 'desc' } }),
    prisma.contextSource.findMany({
      where: { spaceId, ownerKey: SHARED_OWNER_KEY },
      select: { path: true, chunkCount: true },
    }),
  ])
  const chunksByPath = new Map(sources.map((s) => [s.path, s.chunkCount]))
  void context

  return Promise.all(
    rows.map(async (row) => {
      let url: string | null = null
      if (row.gcsPath && process.env.GCS_RESOURCES_BUCKET) {
        try {
          url = await getSignedUrl(RESOURCES_BUCKET(), row.gcsPath)
        } catch {
          // A file whose URL cannot be signed still lists; it just has no link.
        }
      }
      return toDriveFile(row, row.sourcePath ? (chunksByPath.get(row.sourcePath) ?? 0) : 0, url)
    }),
  )
}
