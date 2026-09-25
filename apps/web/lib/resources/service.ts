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
import { folderOfResourceNote } from '@/lib/resources/shared/resourceTree'
import { normalizeSourcePath, sourceKindOf } from '@/lib/notes/shared/sourceTypes'
import { fileResource, resourceFolderPath } from '@/lib/resources/tree'
import { removeFileNode, requireResourceNode } from '@/lib/resources/node'
import { ensureResourceEntity } from '@/lib/resources/entity'
import { addShares, type ShareVia } from '@/lib/resources/shares'
import { syncResourceGrants } from '@/lib/resources/grants'
import { fileTypeOf, kindOf } from '@/lib/resources/shared/kinds'
import { refuseBySniff, refuseUploadByName } from '@/lib/resources/shared/uploadPolicy'
import { ApiError } from '@/lib/api/route'
import { drainJobs, enqueueJobs, type JobKind } from '@/lib/resources/jobs'

/** Per-file ceiling for a file handed over whole (an AI's upload, a drop page). */
export const MAX_RESOURCE_BYTES = 25 * 1024 * 1024

/** The context folder a space's Drive files are indexed under. */
const DRIVE_FOLDER = 'resources'

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
  metadata: Record<string, unknown>
  createdAt: string
}

function contextOf(spaceId: string): Context {
  return { spaceId, ownerKey: SHARED_OWNER_KEY }
}

/**
 * A free context path for this file's text, suffixing on collision. It sits
 * inside the resource's own entity folder (`resources/<slug>/<file>`) when it
 * has one, so the note's audience — a channel's members, the space — is the
 * text's audience too.
 *
 * `.md` is rewritten to `.markdown` by normalizeSourcePath so a source can
 * never collide with the note namespace.
 */
async function freeSourcePath(context: Context, folder: string, filename: string): Promise<string> {
  const safe = normalizeSourcePath(filename.replace(/[/\\]/g, '_').trim() || 'file')
  const dot = safe.lastIndexOf('.')
  const stem = dot > 0 ? safe.slice(0, dot) : safe
  const ext = dot > 0 ? safe.slice(dot) : ''
  for (let n = 0; n < 50; n++) {
    const candidate = `${folder}/${stem}${n ? `-${n + 1}` : ''}${ext}`
    if (!(await sourceStore.findSource(context, candidate))) return candidate
  }
  return `${folder}/${stem}-${randomUUID().slice(0, 8)}${ext}`
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
  /** A folder of `resources/` to file it in; null (the default) is the top. */
  folder?: string | null
  /**
   * The resource node this file is the content of. Omitted, the upload gets a
   * node of its own, named after the file.
   */
  nodeId?: string | null
  /**
   * The channel the file is being dropped into. It is shared nowhere yet — the
   * message that carries it shares it there — so until then it is its
   * uploader's alone.
   */
  conversationId?: string | null
  /** How it arrived; a space share records it. Default `upload`. */
  via?: ShareVia
  agentName?: string | null
}

export type UploadedFile = DriveFile & { nodeId: string | null; kind: string }

/**
 * Store a file and make it a resource: its row, its entity, its share, its
 * note's audience and its searchable text. A file the named node already had
 * is replaced — a Resource record has one file.
 */
export async function uploadResource(input: UploadInput): Promise<UploadedFile> {
  if (input.nodeId) await requireResourceNode(input.spaceId, input.nodeId)
  const folder = await resourceFolderPath(input.spaceId, input.folder)
  const row = await storeResource(input)
  return finishUpload(row.id, {
    nodeId: input.conversationId ? null : (input.nodeId ?? null),
    folder,
    by: input.uploadedBy,
    share: input.conversationId
      ? null
      : { sharedBy: input.uploadedBy, via: input.via ?? 'upload', agentName: input.agentName ?? null },
  })
}

/**
 * Everything after the bytes are stored, for every way a file arrives (a whole
 * buffer here; a resumable upload's `complete`): the entity, the share, the
 * note's audience, then the work it owes — renditions and its text — queued
 * as jobs and drained right here within a budget, so a small file comes back
 * ready and a large one finishes on the next pull or tick. None of it is
 * allowed to fail the upload: the file is stored either way, and `indexState`
 * carries the text's outcome to the UI, where Re-index retries it.
 */
export async function finishUpload(
  resourceId: string,
  opts: {
    nodeId?: string | null
    /** A folder of `resources/` to file its note in, by `by`. */
    folder?: string | null
    by?: string
    share: { sharedBy: string; via: ShareVia; agentName?: string | null } | null
  },
): Promise<UploadedFile> {
  const { nodeId, replacedResourceId } = await ensureResourceEntity(resourceId, { nodeId: opts.nodeId ?? null })
  if (replacedResourceId) await deleteResource(replacedResourceId)
  if (nodeId && opts.folder && opts.by) {
    const row0 = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId }, select: { spaceId: true } })
    const user = await prisma.user.findUnique({ where: { id: opts.by }, select: { id: true, name: true, email: true } })
    const actor = { id: opts.by, name: user?.name ?? 'Member', email: user?.email ?? null }
    await fileResource(row0.spaceId, nodeId, opts.folder, actor).catch((err) =>
      logger.warn('resources.finish.file', { resourceId, folder: opts.folder, err }),
    )
  }
  const row = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } })
  if (opts.share) {
    await addShares([{ resourceId, spaceId: row.spaceId, sharedBy: opts.share.sharedBy, via: opts.share.via, agentName: opts.share.agentName }])
  } else {
    await syncResourceGrants(resourceId)
  }
  const owed: JobKind[] = []
  if (['image', 'pdf', 'slides'].includes(row.kind)) owed.push('rendition')
  if (row.kind !== 'image' && sourceKindOf(row.name)) owed.push('extract')
  else {
    await prisma.resource.update({
      where: { id: resourceId },
      data: {
        indexState: 'unsupported',
        indexError: row.kind === 'image' ? 'Images carry no text to index.' : 'No text extractor for this file type yet.',
      },
    })
  }
  if (owed.length) {
    await enqueueJobs(resourceId, owed)
    await drainJobs({ budgetMs: FINISH_BUDGET_MS, resourceIds: [resourceId] }).catch((err) =>
      logger.warn('resources.finish.drain', { resourceId, err }),
    )
  }
  const done = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } })
  return { ...toDriveFile(done, 0), nodeId, kind: done.kind }
}

/** How long an upload's own request spends on its renditions and text before handing the rest to a pull. */
const FINISH_BUDGET_MS = 8_000

/**
 * Store a file's bytes exactly as they came and record it. The object path is
 * server-minted from the row's own id — the one fact that ties the object to
 * the record.
 */
async function storeResource(input: UploadInput) {
  const { spaceId, buffer, uploadedBy } = input
  if (buffer.length > MAX_RESOURCE_BYTES) {
    throw new Error(`File must be less than ${Math.floor(MAX_RESOURCE_BYTES / 1024 / 1024)}MB`)
  }

  const name = (input.filename || 'file').split(/[/\\]/).pop() || 'file'
  const mimeType = input.mimeType || 'application/octet-stream'
  const refusal = refuseUploadByName(name.replace(/^~+/, ''), buffer.length, MAX_RESOURCE_BYTES)
  if (refusal) throw new ApiError(400, refusal)
  const { fileTypeFromBuffer } = await import('file-type')
  const sniffed = (await fileTypeFromBuffer(buffer.subarray(0, 4100)))?.mime ?? null
  const mismatch = refuseBySniff(name, sniffed)
  if (mismatch) throw new ApiError(415, mismatch)
  const id = randomUUID()
  const gcsPath = resourceObjectPath(spaceId, id, name.replace(/^~+/, '') || 'file')
  await uploadResourceFile(gcsPath, buffer, mimeType)

  const kind = kindOf(name, mimeType)
  let dims: { width?: number; height?: number } = {}
  if (kind === 'image') dims = await imageDimensions(buffer)

  return prisma.resource.create({
    data: {
      id,
      spaceId,
      name,
      fileType: fileTypeOf(name, mimeType),
      kind,
      source: 'upload',
      state: 'ready',
      gcsPath,
      fileSize: buffer.length,
      mimeType,
      ...dims,
      uploadedBy,
      createdBy: uploadedBy,
      indexState: 'pending',
      metadata: { originalFilename: name, mimeType },
    },
  })
}

async function imageDimensions(buffer: Buffer): Promise<{ width?: number; height?: number }> {
  try {
    const sharp = (await import('sharp')).default
    const meta = await sharp(buffer).metadata()
    // EXIF orientations 5–8 turn the picture a quarter: its shown size is swapped.
    const turned = (meta.orientation ?? 1) >= 5
    return turned ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height }
  } catch {
    return {}
  }
}

/**
 * Extract, chunk and embed a stored file's text under its entity folder. With
 * no `bytes` they are read back from the object. A kind with no extractor is
 * recorded `unsupported`, never failed.
 */
export async function indexResource(resourceId: string, bytes?: Buffer): Promise<DriveFile> {
  const resource = await prisma.resource.findUniqueOrThrow({
    where: { id: resourceId },
    include: { node: { select: { id: true, type: true, metadata: true } } },
  })
  const sourceKind = resource.kind === 'image' ? null : sourceKindOf(resource.name)
  if (!sourceKind || !resource.gcsPath) {
    const updated = await prisma.resource.update({
      where: { id: resource.id },
      data: {
        indexState: 'unsupported',
        indexError: resource.kind === 'image' ? 'Images carry no text to index.' : 'No text extractor for this file type yet.',
      },
    })
    return toDriveFile(updated, 0)
  }

  const context = contextOf(resource.spaceId)
  await alignFolderPrivacy(resource.spaceId)
  const folder =
    (resource.node &&
      folderOfResourceNote({
        id: resource.node.id,
        type: resource.node.type,
        metadata: (resource.node.metadata ?? {}) as Record<string, unknown>,
      })) ||
    DRIVE_FOLDER
  try {
    const buffer = bytes ?? (await downloadResourceFile(resource.gcsPath))
    const existing = resource.sourcePath ? await sourceStore.findSource(context, resource.sourcePath) : null
    const meta = existing
      ? await reingestSourceFrom(context, resource.sourcePath!, buffer)
      : await ingestSource(context, {
          path: await freeSourcePath(context, folder, resource.name),
          name: resource.name,
          kind: sourceKind,
          mimeType: resource.mimeType ?? 'application/octet-stream',
          buffer,
          createdBy: resource.createdBy ?? resource.uploadedBy,
          // The Resource owns the object; this source is only its chunked projection.
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
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Indexing failed'
    logger.error('resources.index.failed', { spaceId: resource.spaceId, resourceId: resource.id, err })
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
 * that raced a bad embedding key, a file stored before the pipeline existed, or
 * a change of embedding model. Bytes come back from the Drive's own object,
 * since the source does not own one.
 */
export async function reindexResource(resourceId: string): Promise<DriveFile | null> {
  const resource = await prisma.resource.findUnique({ where: { id: resourceId }, select: { id: true, gcsPath: true } })
  if (!resource) return null
  if (!resource.gcsPath) {
    const updated = await prisma.resource.update({
      where: { id: resource.id },
      data: { indexState: 'failed', indexError: 'The original file is not in storage — re-upload it.' },
    })
    return toDriveFile(updated, 0)
  }
  return indexResource(resource.id)
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
  const renditions = await prisma.resourceRendition.findMany({ where: { resourceId: resource.id }, select: { gcsPath: true } })
  await prisma.resource.delete({ where: { id: resource.id } })
  await removeFileNode(resource.spaceId, resource.id)
  for (const { gcsPath } of renditions) {
    await deleteResourceFile(gcsPath).catch((err) => logger.error('resources.deleteRendition.failed', { resourceId, err }))
  }
  if (resource.previewPath) await deleteResourceFile(resource.previewPath).catch(() => {})

  // Last, and best-effort: an orphaned object costs storage, an orphaned record
  // costs a broken page.
  if (resource.gcsPath) {
    await deleteResourceFile(resource.gcsPath).catch((err) =>
      logger.error('resources.deleteObject.failed', { resourceId, err }),
    )
  }
  return true
}

/** How long a resource waits in the trash for its restore before it is deleted outright. */
const TRASH_KEEP_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Delete outright what has sat in the trash past its keep, oldest first and a
 * bounded number per call — the minute tick is the caller, so a backlog
 * drains over a few minutes rather than in one request. Two ticks racing for
 * one row cost a skipped row, never a failure.
 */
export async function purgeTrash(now = new Date(), limit = 20): Promise<number> {
  const due = await prisma.resource.findMany({
    where: { deletedAt: { lt: new Date(now.getTime() - TRASH_KEEP_MS) } },
    orderBy: { deletedAt: 'asc' },
    take: limit,
    select: { id: true },
  })
  let purged = 0
  for (const { id } of due) {
    try {
      if (await deleteResource(id)) purged++
    } catch (err) {
      logger.warn('resources.trash.purge_skipped', { resourceId: id, err })
    }
  }
  if (purged) logger.info('resources.trash.purged', { count: purged })
  return purged
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
    // The space's Drive: what is shared to the space itself. Everything a
    // viewer can see, channels included, is lib/resources/list.ts.
    prisma.resource.findMany({
      where: { spaceId, source: 'upload', deletedAt: null, shares: { some: { conversationId: null } } },
      orderBy: { createdAt: 'desc' },
    }),
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
