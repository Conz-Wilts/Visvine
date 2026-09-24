/**
 * Bring every resource into the one-resource-many-shares shape. Idempotent —
 * run by `db:resources:reshape` after the resources_shares migration and by
 * the seed after it writes the Drive:
 *
 * 1. Every upload gets its kind and first share (the space, or the channel it
 *    was dropped in), for rows written without them.
 * 2. Every uploaded resource gets its entity (a channel's files had none).
 * 3. Every link a person added as a `resource` node gets its `Resource` row,
 *    bound to that node and shared to the space.
 * 4. Every link unfurled in a space channel's message becomes (or joins) the
 *    space's resource for its canonical URL, shared on that message, carrying
 *    the unfurl already fetched.
 * 5. Every resource's note audience, and every private channel's, is
 *    re-derived from its shares.
 */
import prisma from '@/lib/prisma'
import { ensureResourceEntity } from '@/lib/resources/entity'
import { upsertLinkResource } from '@/lib/resources/linkRecord'
import { addShares } from '@/lib/resources/shares'
import { syncChannelNoteGrants, syncResourceGrants } from '@/lib/resources/grants'
import { canonicalUrl } from '@/lib/links/shared/providers'
import { fileIdOf } from '@/lib/resources/shared/fileNode'
import { fileTypeOf, kindOf } from '@/lib/resources/shared/kinds'

export interface ReshapeCounts {
  kinds: number
  shares: number
  entities: number
  linkNodes: number
  messageLinks: number
  grants: number
  channels: number
}

export async function reshapeResources(
  { spaceId: only, dry = false, log = () => {} }: { spaceId?: string; dry?: boolean; log?: (line: string) => void } = {},
): Promise<ReshapeCounts> {
  const inSpace = only ? { spaceId: only } : {}
  const counts: ReshapeCounts = { kinds: 0, shares: 0, entities: 0, linkNodes: 0, messageLinks: 0, grants: 0, channels: 0 }

  // 1. Kinds and first shares for uploads written without them.
  const unshaped = await prisma.resource.findMany({
    where: { ...inSpace, source: 'upload', OR: [{ kind: 'other' }, { shares: { none: {} } }] },
    select: {
      id: true, spaceId: true, name: true, kind: true, mimeType: true, metadata: true, uploadedBy: true,
      createdBy: true, conversationId: true, createdAt: true, _count: { select: { shares: true } },
    },
  })
  log(`${unshaped.length} upload(s) to shape`)
  for (const row of unshaped) {
    if (dry) continue
    const mime = row.mimeType ?? ((row.metadata as { mimeType?: string } | null)?.mimeType ?? null)
    const original = (row.metadata as { originalFilename?: string } | null)?.originalFilename ?? row.name
    const kind = kindOf(original, mime)
    if (row.kind === 'other' && kind !== 'other') {
      const creator = row.createdBy ?? (await prisma.user.findUnique({ where: { id: row.uploadedBy }, select: { id: true } }))?.id ?? null
      await prisma.resource.update({
        where: { id: row.id },
        data: { kind, mimeType: mime, fileType: fileTypeOf(original, mime), createdBy: creator },
      })
      counts.kinds++
    }
    if (row._count.shares === 0 && !row.conversationId) {
      await addShares([{ resourceId: row.id, spaceId: row.spaceId, sharedBy: row.createdBy, via: 'upload' }])
      counts.shares++
    }
  }

  // 2. Entities for uploads.
  const bare = await prisma.resource.findMany({
    where: { ...inSpace, nodeId: null, source: 'upload', deletedAt: null },
    select: { id: true, name: true },
  })
  log(`${bare.length} upload(s) without an entity`)
  for (const row of bare) {
    if (dry) continue
    const { nodeId } = await ensureResourceEntity(row.id, { revalidate: false })
    if (nodeId) counts.entities++
  }

  // 3. Link nodes a person added.
  const linkNodes = await prisma.node.findMany({
    where: { ...inSpace, type: { equals: 'resource', mode: 'insensitive' }, url: { not: null }, resource: null },
    select: { id: true, spaceId: true, name: true, url: true, metadata: true, createdAt: true },
  })
  log(`${linkNodes.length} link node(s) without a resource`)
  for (const node of linkNodes) {
    if (dry || !node.spaceId || !node.url || fileIdOf(node.metadata)) continue
    const canonical = canonicalUrl(node.url)
    if (!canonical) continue
    const record = await upsertLinkResource({ spaceId: node.spaceId, url: node.url, createdBy: null, name: node.name })
    if (!record) continue
    const metadata = { ...((node.metadata as Record<string, unknown> | null) ?? {}), fileId: record.id }
    await prisma.$transaction([
      prisma.resource.updateMany({ where: { nodeId: node.id }, data: { nodeId: null } }),
      prisma.resource.update({ where: { id: record.id }, data: { nodeId: node.id, createdAt: node.createdAt } }),
      prisma.node.update({ where: { id: node.id }, data: { metadata } }),
    ])
    await addShares([{ resourceId: record.id, spaceId: node.spaceId, sharedBy: null, via: 'link' }])
    counts.linkNodes++
  }

  // 4. Links unfurled in channel messages.
  const previews = await prisma.messageLinkPreview.findMany({
    where: {
      message: { deletedAt: null, conversation: { type: 'CHANNEL', spaceId: only ?? { not: null } } },
    },
    select: {
      messageId: true,
      createdAt: true,
      linkPreview: true,
      message: { select: { senderId: true, conversation: { select: { id: true, spaceId: true } } } },
    },
  })
  log(`${previews.length} message link preview(s)`)
  for (const preview of previews) {
    const spaceId = preview.message.conversation.spaceId
    if (dry || !spaceId) continue
    const lp = preview.linkPreview
    const sender = await prisma.user.findUnique({ where: { id: preview.message.senderId }, select: { id: true } })
    const record = await upsertLinkResource({ spaceId, url: lp.url, createdBy: sender?.id ?? null, name: lp.title })
    if (!record) continue
    if (record.created) {
      await prisma.resource.update({
        where: { id: record.id },
        data: {
          createdAt: preview.createdAt,
          fetchedAt: lp.fetchedAt,
          fetchState: 'ok',
          entitySource: 'scrape',
          unfurl: {
            title: lp.title,
            description: lp.description,
            siteName: lp.siteName,
            authorName: lp.authorName,
            mediaType: lp.mediaType,
            imageLayout: lp.imageLayout,
            sourceImageUrl: lp.imageUrl,
            sourceFaviconUrl: lp.faviconUrl,
          },
        },
      })
    }
    const already = await prisma.resourceShare.findUnique({
      where: { messageId_resourceId: { messageId: preview.messageId, resourceId: record.id } },
      select: { id: true },
    })
    if (!already) {
      await addShares([
        {
          resourceId: record.id,
          spaceId,
          conversationId: preview.message.conversation.id,
          messageId: preview.messageId,
          sharedBy: sender?.id ?? null,
          via: 'message',
        },
      ])
    }
    await ensureResourceEntity(record.id, { revalidate: false })
    counts.messageLinks++
  }

  // 5. Audiences.
  if (!dry) {
    const all = await prisma.resource.findMany({ where: inSpace, select: { id: true } })
    for (const row of all) {
      await syncResourceGrants(row.id)
      counts.grants++
    }
    const privateChannels = await prisma.conversation.findMany({
      where: { type: 'CHANNEL', visibility: 'PRIVATE', ...(only ? { spaceId: only } : {}) },
      select: { id: true },
    })
    for (const channel of privateChannels) {
      await syncChannelNoteGrants(channel.id)
      counts.channels++
    }
  }

  return counts
}

