/**
 * The one writer of who a resource's note — and a private channel's — is
 * shown to in the context. The rule is the resource's visibility
 * (`shared/visibility.ts#noteAudience`): a share to the space leaves the
 * entity's folder under the space's own grants; channel-only shares restrict
 * the folder and grant it, at view, to each of those channels (a resource
 * shared nowhere, to its creator). Search, the tree, backlinks and the source
 * chunks under the folder all read through that one boundary, so nothing
 * downstream learns a special case.
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { LEVEL_VIEW } from '@/lib/notes/shared/authz'
import { SHARED_OWNER_KEY } from '@/lib/notes/store'
import { folderOfResourceNote } from '@/lib/resources/shared/resourceTree'
import { findNodeIdByRecord } from '@/lib/notes/context/entityNodes'
import { noteAudience, type NoteAudience } from './shared/visibility'

/** Grants this writer owns are marked so, and it never touches anyone else's. */
const SYSTEM_GRANTOR = 'system:audience'

/**
 * Hold an entity folder to an audience. Opening a folder only lifts a
 * restriction THIS writer made, so a folder an admin restricted by hand stays
 * restricted, and a grant a person made on it is never removed.
 */
async function syncFolderAudience(spaceId: string, folder: string, audience: NoteAudience): Promise<void> {
  const existing = await prisma.contextGrant.findMany({
    where: { spaceId, resourcePath: folder, grantedBy: SYSTEM_GRANTOR },
    select: { id: true, subjectType: true, subjectId: true },
  })
  const want = new Set(
    audience.open
      ? []
      : [
          ...audience.channelIds.map((id) => `channel:${id}`),
          ...audience.userIds.map((id) => `user:${id}`),
        ],
  )
  const keyOf = (grant: { subjectType: string; subjectId: string }) => `${grant.subjectType}:${grant.subjectId}`
  const stale = existing.filter((grant) => !want.has(keyOf(grant))).map((grant) => grant.id)
  const have = new Set(existing.map(keyOf))
  const identity = { spaceId, ownerKey: SHARED_OWNER_KEY, path: folder }
  const hadMarker = existing.length > 0
  const wasOurs = hadMarker || (await isOurRestriction(spaceId, folder))

  await prisma.$transaction(async (tx) => {
    if (stale.length) await tx.contextGrant.deleteMany({ where: { id: { in: stale } } })
    for (const key of want) {
      if (have.has(key)) continue
      const [subjectType, subjectId] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
      await tx.contextGrant.upsert({
        where: { grant_identity: { spaceId, subjectType, subjectId, resourcePath: folder } },
        create: { spaceId, subjectType, subjectId, resourcePath: folder, level: LEVEL_VIEW, grantedBy: SYSTEM_GRANTOR },
        update: {},
      })
    }
    if (!audience.open) {
      await tx.contextFolder.upsert({
        where: { folder_identity: identity },
        create: { ...identity, restricted: true },
        update: { restricted: true },
      })
    } else if (wasOurs) {
      await tx.contextFolder.updateMany({ where: identity, data: { restricted: false } })
    }
  })
}

/**
 * A restriction with no grants of ours left on it is still ours when nothing
 * else could have made it: a resource folder shared nowhere at all has none
 * of our grants only when its creator is gone.
 */
async function isOurRestriction(spaceId: string, folder: string): Promise<boolean> {
  const other = await prisma.contextGrant.count({ where: { spaceId, resourcePath: folder } })
  return other === 0 && /^(resources|channels)\//.test(folder)
}

/** The context folder a node's entity note sits in, or null. */
function folderOfNode(node: { id: string; type: string; metadata: unknown }): string | null {
  return folderOfResourceNote({
    id: node.id,
    type: node.type,
    metadata: (node.metadata ?? {}) as Record<string, unknown>,
  })
}

/** Re-derive a resource's note audience from its shares. Idempotent. */
export async function syncResourceGrants(resourceId: string): Promise<void> {
  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: {
      spaceId: true,
      createdBy: true,
      node: { select: { id: true, type: true, metadata: true } },
      shares: { select: { conversationId: true } },
    },
  })
  if (!resource?.node) return
  const folder = folderOfNode(resource.node)
  if (!folder) return
  try {
    await syncFolderAudience(resource.spaceId, folder, noteAudience(resource))
  } catch (err) {
    logger.error('resources.grants.sync.failed', { resourceId, err })
  }
}

/** A private channel's note is its members'; a public one's is the space's. */
export async function syncChannelNoteGrants(conversationId: string): Promise<void> {
  const channel = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { spaceId: true, visibility: true },
  })
  if (!channel?.spaceId) return
  const nodeId = await findNodeIdByRecord(channel.spaceId, 'channel', conversationId)
  const node = nodeId
    ? await prisma.node.findUnique({ where: { id: nodeId }, select: { id: true, type: true, metadata: true } })
    : null
  const folder = node ? folderOfNode(node) : null
  if (!folder) return
  const audience: NoteAudience =
    channel.visibility === 'PRIVATE' ? { open: false, channelIds: [conversationId], userIds: [] } : { open: true }
  try {
    await syncFolderAudience(channel.spaceId, folder, audience)
  } catch (err) {
    logger.error('channels.grants.sync.failed', { conversationId, err })
  }
}
