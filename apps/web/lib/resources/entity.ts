/**
 * Every resource is a context entity: a `resource:<slug>` node whose note, at
 * `resources/<slug>/index.md`, is the prose people and agents write about it.
 * This is the one door that makes that true — for an upload, a link, a file
 * dropped in a channel, an MCP upload — and it records the node on the row
 * (`resources.node_id`), so the note's path is stable from then on.
 *
 * The note holds meaning; the row holds facts. Kind, size, URL, provider and
 * shares are never written into the note — `read_resource` renders them from
 * the row.
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { syncEntityNode } from '@/lib/notes/context/entityNodes'
import { freeNodeId, linkFileNode } from '@/lib/resources/node'
import { resourceNameOf } from '@/lib/resources/shared/fileNode'
import type { Actor } from '@/lib/notes/store'

async function actorOf(userId: string | null): Promise<Actor | null> {
  if (!userId) return null
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } })
  return user ? { id: user.id, name: user.name ?? 'Member', email: user.email } : null
}

export interface EnsuredEntity {
  nodeId: string | null
  /** The resource the named node showed before, which the caller deletes. */
  replacedResourceId: string | null
}

/**
 * Give a resource its entity, or bind it to `nodeId` (a Resource record the
 * upload was FOR — its previous file is returned for the caller to delete).
 * Idempotent: a resource that already has its node keeps it.
 */
export async function ensureResourceEntity(
  resourceId: string,
  { nodeId = null, revalidate = true }: { nodeId?: string | null; revalidate?: boolean } = {},
): Promise<EnsuredEntity> {
  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: {
      id: true,
      spaceId: true,
      name: true,
      source: true,
      url: true,
      unfurl: true,
      nodeId: true,
      createdBy: true,
      uploadedBy: true,
    },
  })
  if (!resource) return { nodeId: null, replacedResourceId: null }
  if (resource.nodeId && (!nodeId || nodeId === resource.nodeId)) {
    return { nodeId: resource.nodeId, replacedResourceId: null }
  }

  let bound: string | null = null
  let replacedResourceId: string | null = null
  try {
    if (resource.source === 'upload') {
      const linked = await linkFileNode(
        { id: resource.id, spaceId: resource.spaceId, name: resource.name, uploadedBy: resource.createdBy ?? resource.uploadedBy },
        nodeId,
        { revalidate },
      )
      bound = linked.nodeId
      replacedResourceId = linked.replacedFileId
    } else {
      const description = (resource.unfurl as { description?: string } | null)?.description ?? null
      const name = resourceNameOf(resource.name)
      const synced = await syncEntityNode({
        spaceId: resource.spaceId,
        type: 'resource',
        nodeId: await freeNodeId(resource.spaceId, name),
        name,
        recordId: resource.id,
        url: resource.url,
        subtitle: description ? description.slice(0, 280) : null,
        actor: await actorOf(resource.createdBy),
        revalidate,
      })
      if (synced.noteError) logger.warn('resources.entity.note', { resourceId, noteError: synced.noteError })
      bound = synced.nodeId
    }
  } catch (err) {
    // The resource is stored either way; the backfill gives it a node later.
    logger.error('resources.entity.failed', { resourceId, err })
    return { nodeId: null, replacedResourceId: null }
  }
  if (!bound) return { nodeId: null, replacedResourceId: null }

  await prisma.$transaction([
    // One node, one resource: a node that showed another file now shows this one.
    prisma.resource.updateMany({ where: { nodeId: bound, id: { not: resource.id } }, data: { nodeId: null } }),
    prisma.resource.update({ where: { id: resource.id }, data: { nodeId: bound } }),
  ])
  return { nodeId: bound, replacedResourceId: replacedResourceId === resource.id ? null : replacedResourceId }
}
