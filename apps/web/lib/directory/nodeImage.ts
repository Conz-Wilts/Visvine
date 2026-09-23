/**
 * A Drive image becomes an entity's picture — a person's photo, an
 * organisation's logo, a resource's thumbnail.
 *
 * The write is the one `PATCH /api/nodes/<id>` makes for `image_url`, asked
 * under the same gates: the node is in the named space, the caller is an active
 * member of it, a Visvine record is not edited locally, and a node following
 * its record takes no local edit. The bytes are copied inside the tenant
 * (lib/events/cover.ts#imageUrlFromResource) — a caller names a Drive file,
 * never a URL — into the prefix `purgeNodeObjects` collects with the node.
 */
import { revalidateTag } from 'next/cache'
import prisma from '@/lib/prisma'
import { ApiError } from '@/lib/api/route'
import { spaceMemberForbidden } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/session'
import { isGlobalSpace } from '@/lib/spaces/globalSpace'
import { GLOBAL_MODE_KEY, syncGlobalRecordSafe } from '@/lib/global/record'
import { syncEntityNoteFrontmatter } from '@/lib/notes/context/entityNodes'
import { imageUrlFromResource } from '@/lib/events/cover'

export interface NodeImageInput {
  spaceId: string
  nodeId: string
  resourceId: string
  actor: { id: string; name: string; email: string | null }
}

export async function setNodeImageFromResource(input: NodeImageInput): Promise<{ imageUrl: string }> {
  const { spaceId, nodeId, resourceId, actor } = input
  const node = await prisma.node.findUnique({
    where: { id: nodeId },
    select: { spaceId: true, type: true, metadata: true, identityId: true },
  })
  // Absent and in another space read the same.
  if (!node || node.spaceId !== spaceId) throw new ApiError(404, `No entity '${nodeId}' in this space`)
  if (node.type === 'event') {
    throw new ApiError(400, "An event's picture is its cover — pass cover_resource_id to update_event")
  }
  if (await spaceMemberForbidden(actor.id, spaceId, actor.email)) {
    throw new ApiError(403, 'Only an active member of the space can change its entities')
  }
  if (isGlobalSpace(spaceId) && !isSuperAdmin(actor.email)) {
    throw new ApiError(403, 'Visvine records are built from public spaces and profiles, not edited here')
  }
  if (((node.metadata as Record<string, unknown> | null) ?? {})[GLOBAL_MODE_KEY] === 'follow') {
    throw new ApiError(409, 'This entity follows its Visvine record — detach it to edit here')
  }

  const imageUrl = await imageUrlFromResource({
    spaceId,
    kind: node.type === 'person' ? 'person' : 'card',
    entityId: nodeId,
    resourceId,
  })
  const updated = await prisma.node.update({
    where: { id: nodeId },
    data: { imageUrl },
    select: { id: true, type: true, spaceId: true, name: true, location: true, metadata: true },
  })
  if (updated.spaceId) {
    await syncEntityNoteFrontmatter(
      {
        ...updated,
        spaceId: updated.spaceId,
        metadata: (updated.metadata as Record<string, unknown> | null) ?? null,
      },
      actor,
    )
  }
  await syncGlobalRecordSafe(node.identityId)
  revalidateTag('context-data-v2', { expire: 0 })
  return { imageUrl }
}
