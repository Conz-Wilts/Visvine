/**
 * A Drive file is the content of a Resource.
 *
 * The Resource is a `resource` node with its note in `resources/`, like any
 * record in the Directory; `metadata.fileId` names the `Resource` row holding
 * the bytes, and the node's page shows that file. Every upload has one: it is
 * either made for the file (named after it) or is the node the upload was for —
 * except a file dropped into a channel, which is the channel's and has none.
 */
import prisma from '@/lib/prisma'
import { ApiError } from '@/lib/api/route'
import { logger } from '@/lib/logger'
import { entityIndexPathOf, entityNotePath } from '@/lib/notes/entities'
import { readNoteOrNull, SHARED_OWNER_KEY, type Actor } from '@/lib/notes/store'
import { findNodeIdByRecord, removeEntityNode, syncEntityNode } from '@/lib/notes/context/entityNodes'
import { slugify } from '@/lib/eventUtils'
import { fileIdOf, resourceNameOf } from '@/lib/resources/shared/fileNode'

const MAX_ID_ATTEMPTS = 25

interface FileRecord {
  id: string
  spaceId: string
  name: string
  uploadedBy: string
}

/** Refuses a node that is not a resource of this space. */
export async function requireResourceNode(spaceId: string, nodeId: string): Promise<void> {
  const node = await prisma.node.findUnique({ where: { id: nodeId }, select: { spaceId: true, type: true } })
  if (!node || node.spaceId !== spaceId || node.type.toLowerCase() !== 'resource') {
    throw new ApiError(404, 'Resource not found')
  }
}

async function actorOf(userId: string): Promise<Actor | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } })
  return user ? { id: user.id, name: user.name ?? 'Member', email: user.email } : null
}

/** A `resource:<slug>` id no node holds and whose note path is free. */
async function freeNodeId(spaceId: string, name: string): Promise<string> {
  const context = { spaceId, ownerKey: SHARED_OWNER_KEY }
  const base = `resource:${slugify(name) || 'file'}`
  for (let attempt = 1; attempt <= MAX_ID_ATTEMPTS; attempt++) {
    const id = attempt === 1 ? base : `${base}-${attempt}`
    if (await prisma.node.findUnique({ where: { id }, select: { id: true } })) continue
    const node = { id, type: 'resource' }
    const paths = [entityNotePath(node), entityIndexPathOf(node)].filter((p): p is string => !!p)
    const taken = await Promise.all(paths.map((p) => readNoteOrNull(context, p)))
    if (taken.every((note) => note === null)) return id
  }
  return `${base}-${Date.now().toString(36)}`
}

/**
 * Bind a file to its Resource. With `nodeId`, that node now shows this file and
 * the one it showed before is returned for the caller to delete. Without, the
 * file's existing node is kept, or a new one is made — never an existing node
 * that merely shares the name, which is someone else's record.
 */
export async function linkFileNode(
  file: FileRecord,
  nodeId: string | null,
  /** False outside a request (the seed, the backfill), where there is no cache to bust. */
  { revalidate = true }: { revalidate?: boolean } = {},
): Promise<{ nodeId: string | null; replacedFileId: string | null }> {
  try {
    if (nodeId) {
      const node = await prisma.node.findUnique({ where: { id: nodeId }, select: { metadata: true } })
      const metadata = (node?.metadata as Record<string, unknown> | null) ?? {}
      await prisma.node.update({ where: { id: nodeId }, data: { metadata: { ...metadata, fileId: file.id } } })
      return { nodeId, replacedFileId: fileIdOf(metadata) }
    }

    const existing = await findNodeIdByRecord(file.spaceId, 'resource', file.id)
    if (existing) return { nodeId: existing, replacedFileId: null }

    const name = resourceNameOf(file.name)
    const { nodeId: created, noteError } = await syncEntityNode({
      spaceId: file.spaceId,
      type: 'resource',
      nodeId: await freeNodeId(file.spaceId, name),
      name,
      recordId: file.id,
      actor: await actorOf(file.uploadedBy),
      revalidate,
    })
    if (noteError) logger.warn('resources.node.note', { fileId: file.id, noteError })
    return { nodeId: created, replacedFileId: null }
  } catch (err) {
    // The file is stored and indexed either way; a node is what a backfill makes.
    logger.error('resources.node.link.failed', { err, fileId: file.id })
    return { nodeId: null, replacedFileId: null }
  }
}

/** The file is gone, so its Resource is too. The note stays — it is what people wrote. */
export async function removeFileNode(spaceId: string, fileId: string): Promise<void> {
  await removeEntityNode(spaceId, 'resource', fileId)
}

/** The files the given nodes show — deleted with them. */
export async function fileIdsOfNodes(nodeIds: string[]): Promise<string[]> {
  if (nodeIds.length === 0) return []
  const rows = await prisma.node.findMany({
    where: { id: { in: nodeIds }, type: { equals: 'resource', mode: 'insensitive' } },
    select: { metadata: true },
  })
  return rows.map((row) => fileIdOf(row.metadata)).filter((id): id is string => !!id)
}
