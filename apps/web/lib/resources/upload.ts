/**
 * A resumable upload, Slack's three steps (`getUploadURLExternal`, PUT the
 * bytes, `completeUploadExternal`):
 *
 * 1. `initUpload` asks the gates, refuses a program by name, records the
 *    resource as `uploading` with a server-minted object path, and opens a
 *    resumable session — on GCS the browser then PUTs chunks straight to the
 *    bucket, so no request here ever carries more than the JSON; under the
 *    local driver the session is `/api/resources/uploads/<id>`, speaking the
 *    same Content-Range protocol.
 * 2. The client sends 8 MiB chunks and, after a drop, asks where it got to.
 * 3. `completeUpload` stats the object, sniffs its first bytes against its
 *    name, takes the store's md5 as its hash, asks the scanner, and hands the
 *    file to `finishUpload` — entity, share, audience, renditions, text.
 *
 * The original is never touched: renditions are separate objects.
 */
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { ApiError } from '@/lib/api/route'
import { featureAccessForbidden } from '@/lib/auth'
import {
  deleteResourceFile,
  readResourceHead,
  RESOURCES_BUCKET,
  startResumableUpload,
  statResourceObject,
  storageDriver,
} from '@/lib/gcs'
import { localAppendChunk, localDropStaged, localFinishStaged, localStagedSize } from '@/lib/storage/localStore'
import { resourceObjectPath } from '@/lib/storage/objectPaths'
import { requireResourceNode } from '@/lib/resources/node'
import { resourceFolderPath } from '@/lib/resources/tree'
import { requireDriveWriter } from '@/lib/resources/receive'
import { requireChannelOfSpace } from '@/lib/resources/access'
import { finishUpload, type UploadedFile } from '@/lib/resources/service'
import { scanUpload } from '@/lib/resources/scan'
import { fileTypeOf, kindOf } from '@/lib/resources/shared/kinds'
import { DEFAULT_MAX_UPLOAD_BYTES, refuseBySniff, refuseUploadByName } from '@/lib/resources/shared/uploadPolicy'

/** A chunk: GCS wants a multiple of 256 KiB; 8 MiB keeps a retry cheap. */
const CHUNK_BYTES = 8 * 1024 * 1024

/** An upload nobody completed within a day is abandoned. */
const ABANDONED_MS = 24 * 60 * 60 * 1000

function maxUploadBytes(): number {
  const set = Number(process.env.RESOURCE_MAX_BYTES)
  return Number.isFinite(set) && set > 0 ? Math.min(set, DEFAULT_MAX_UPLOAD_BYTES) : DEFAULT_MAX_UPLOAD_BYTES
}

interface PendingMeta {
  mimeType: string
  originalFilename: string
  conversationId: string | null
  nodeId: string | null
  folder?: string | null
}

function pendingOf(metadata: unknown): PendingMeta {
  const m = (metadata ?? {}) as Partial<PendingMeta>
  return {
    mimeType: m.mimeType ?? 'application/octet-stream',
    originalFilename: m.originalFilename ?? 'file',
    conversationId: m.conversationId ?? null,
    nodeId: m.nodeId ?? null,
    folder: m.folder ?? null,
  }
}

export interface InitInput {
  userId: string
  email?: string | null
  spaceId: string
  name: string
  size: number
  mimeType?: string | null
  /** A folder of `resources/` to file it in (lib/resources/tree.ts#resourceFolderPath). */
  folder?: string | null
  /** A Resource record this file becomes the content of. */
  nodeId?: string | null
  /** The channel it is being dropped into; shared there when the message is sent. */
  conversationId?: string | null
  /** The page's origin, which a GCS session is bound to for CORS. */
  origin: string
}

export interface InitResult {
  id: string
  uploadUrl: string
  chunkSize: number
}

/** Who may upload here: into a channel they are in, or into the space's Resources. */
async function requireUploader(userId: string, spaceId: string, email: string | null | undefined, conversationId: string | null) {
  if (!conversationId) return requireDriveWriter(userId, spaceId, email)
  await requireChannelOfSpace(conversationId, spaceId, userId)
  if (await featureAccessForbidden(userId, spaceId, 'channels', email)) {
    throw new ApiError(403, 'Channels are not available to you in this space')
  }
}

export async function initUpload(input: InitInput): Promise<InitResult> {
  const name = input.name.split(/[/\\]/).pop()?.trim() ?? ''
  const conversationId = input.conversationId ?? null
  await requireUploader(input.userId, input.spaceId, input.email, conversationId)
  const refusal = refuseUploadByName(name, input.size, maxUploadBytes())
  if (refusal) throw new ApiError(400, refusal)
  if (name.startsWith('~')) throw new ApiError(400, 'A file name cannot start with ~')
  const folder = await resourceFolderPath(input.spaceId, input.folder)
  if (input.nodeId) await requireResourceNode(input.spaceId, input.nodeId)

  const id = randomUUID()
  const mimeType = input.mimeType || 'application/octet-stream'
  const gcsPath = resourceObjectPath(input.spaceId, id, name)
  await prisma.resource.create({
    data: {
      id,
      spaceId: input.spaceId,
      name,
      fileType: fileTypeOf(name, mimeType),
      kind: kindOf(name, mimeType),
      source: 'upload',
      state: 'uploading',
      gcsPath,
      fileSize: input.size,
      mimeType,
      uploadedBy: input.userId,
      createdBy: input.userId,
      indexState: 'pending',
      scanState: 'pending',
      metadata: { originalFilename: name, mimeType, conversationId, nodeId: input.nodeId ?? null, folder } satisfies PendingMeta,
    },
  })
  const session = await startResumableUpload(gcsPath, mimeType, input.origin)
  return { id, uploadUrl: session ?? `/api/resources/uploads/${id}`, chunkSize: CHUNK_BYTES }
}

async function requirePending(id: string, userId: string) {
  const row = await prisma.resource.findUnique({
    where: { id },
    select: { id: true, spaceId: true, name: true, state: true, createdBy: true, gcsPath: true, fileSize: true, metadata: true },
  })
  // Only the uploader ever learns an upload exists.
  if (!row || row.createdBy !== userId || !row.gcsPath) throw new ApiError(404, 'Not found')
  return row
}

/** Under the local driver, where a chunk lands. Mirrors a GCS session's replies. */
export async function receiveLocalChunk(
  id: string,
  userId: string,
  range: string | null,
  body: Buffer,
): Promise<{ complete: boolean; received: number }> {
  if (storageDriver() !== 'local') throw new ApiError(404, 'Not found')
  const row = await requirePending(id, userId)
  if (row.state !== 'uploading') return { complete: true, received: row.fileSize ?? 0 }
  const total = row.fileSize ?? 0
  const bucket = RESOURCES_BUCKET()
  // `bytes */<total>` asks how much has arrived; `bytes a-b/<total>` sends a chunk.
  const status = /^bytes \*\/(\d+)$/.exec(range ?? '')
  if (status) {
    const received = await localStagedSize(bucket, id)
    return { complete: received >= total, received }
  }
  const chunk = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range ?? '')
  if (!chunk) throw new ApiError(400, 'Content-Range is required')
  const [start, end, declared] = [Number(chunk[1]), Number(chunk[2]), Number(chunk[3])]
  if (declared !== total || end >= total || end - start + 1 !== body.length) {
    throw new ApiError(400, 'That chunk does not fit the upload')
  }
  const received = await localAppendChunk(bucket, id, start, body)
  if (received >= total) {
    const meta = pendingOf(row.metadata)
    await localFinishStaged(bucket, id, row.gcsPath!, meta.mimeType)
    return { complete: true, received }
  }
  return { complete: false, received }
}

async function abandon(row: { id: string; gcsPath: string | null }): Promise<void> {
  if (row.gcsPath) await deleteResourceFile(row.gcsPath).catch(() => {})
  if (storageDriver() === 'local') await localDropStaged(RESOURCES_BUCKET(), row.id).catch(() => {})
  await prisma.resource.delete({ where: { id: row.id } }).catch(() => {})
}

/** Finish an upload whose bytes have all arrived. */
export async function completeUpload(id: string, userId: string): Promise<UploadedFile & { conversationId: string | null }> {
  const row = await requirePending(id, userId)
  const meta = pendingOf(row.metadata)
  if (row.state !== 'uploading') {
    const done = await prisma.resource.findUniqueOrThrow({ where: { id } })
    return { ...(await finishedShape(done.id)), conversationId: meta.conversationId }
  }
  const stat = await statResourceObject(row.gcsPath!)
  if (!stat) throw new ApiError(409, 'Not all of the file has arrived yet')
  if (stat.size > maxUploadBytes()) {
    await abandon(row)
    throw new ApiError(413, 'That file is larger than uploads allow')
  }

  const head = await readResourceHead(row.gcsPath!)
  const { fileTypeFromBuffer } = await import('file-type')
  const sniffed = head ? ((await fileTypeFromBuffer(head))?.mime ?? null) : null
  const refusal = refuseBySniff(row.name, sniffed)
  if (refusal) {
    await abandon(row)
    throw new ApiError(415, refusal)
  }

  const verdict = await scanUpload(row.gcsPath!)
  if (verdict === 'blocked') {
    await abandon(row)
    throw new ApiError(422, `${row.name} was blocked by the scanner`)
  }

  const mimeType = meta.mimeType === 'application/octet-stream' && sniffed ? sniffed : meta.mimeType
  await prisma.resource.update({
    where: { id },
    data: {
      state: 'ready',
      fileSize: stat.size,
      contentHash: stat.md5,
      mimeType,
      kind: kindOf(row.name, mimeType),
      fileType: fileTypeOf(row.name, mimeType),
      scanState: verdict,
      createdAt: new Date(),
    },
  })
  const file = await finishUpload(id, {
    nodeId: meta.conversationId ? null : meta.nodeId,
    folder: meta.folder,
    by: userId,
    share: meta.conversationId ? null : { sharedBy: userId, via: 'upload' },
  })
  return { ...file, conversationId: meta.conversationId }
}

async function finishedShape(id: string): Promise<UploadedFile> {
  const row = await prisma.resource.findUniqueOrThrow({ where: { id } })
  return {
    id: row.id,
    spaceId: row.spaceId,
    name: row.name,
    fileType: row.fileType,
    fileUrl: null,
    fileSize: row.fileSize,
    uploadedBy: row.uploadedBy,
    sourcePath: row.sourcePath,
    indexState: row.indexState as UploadedFile['indexState'],
    indexError: row.indexError,
    chunkCount: 0,
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
    createdAt: row.createdAt.toISOString(),
    nodeId: row.nodeId,
    kind: row.kind,
  }
}

/** Drop uploads nobody finished: their row, their object, their staging. */
export async function reapAbandonedUploads(now = new Date()): Promise<number> {
  const stale = await prisma.resource.findMany({
    where: { state: 'uploading', createdAt: { lt: new Date(now.getTime() - ABANDONED_MS) } },
    select: { id: true, gcsPath: true },
    take: 100,
  })
  for (const row of stale) await abandon(row)
  if (stale.length) logger.info('resources.uploads.reaped', { count: stale.length })
  return stale.length
}
