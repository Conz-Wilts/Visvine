/**
 * The Resources tab's one read: every file and link a space holds, from the
 * four places they arrive (lib/resources/shared/library.ts is the fold).
 *
 * What the viewer sees is what they could already open elsewhere: the space's
 * Drive and its resource and event records (the Directory's own standing,
 * checked by the route), plus the files and links of the channels they are IN,
 * while Channels is a tool they can open — the feed's rule
 * (lib/messages/feedService.ts). A DM belongs to no space and is never here.
 */
import { ConversationType } from '@prisma/client'
import prisma from '@/lib/prisma'
import { getSpaceNodes } from '@/lib/eventRepo'
import { canAccessFeature } from '@/lib/featureAccess'
import { getFeatureConfig, isAdmin } from '@/lib/auth'
import { fileIdOf, resourceRawPath } from '@/lib/resources/shared/fileNode'
import { hostOf, isHttpUrl } from '@/lib/links/shared/unfurl'
import {
  foldLibrary,
  linkKey,
  type LibraryFilter,
  type LibraryItem,
  type LibraryPage,
} from '@/lib/resources/shared/library'
import type { NBNode } from '@/lib/types'
import { resourceViewer, visibleResourceWhere } from '@/lib/resources/visibility'

/** Rows read per source for one page — the fold cuts to a page after merging. */
const PER_SOURCE = 150

export interface LibraryQuery {
  filter: LibraryFilter
  q?: string
  /** ISO time: only items older than this. */
  before?: string | null
}

const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : new Date(0).toISOString()

/** The channels of `spaceId` whose files and links `userId` may see here. */
async function readableChannels(spaceId: string, userId: string, email?: string | null) {
  const [config, admin] = await Promise.all([getFeatureConfig(spaceId), isAdmin(userId, spaceId, email)])
  if (!canAccessFeature(config, 'channels', admin)) return new Map<string, string>()
  const channels = await prisma.conversation.findMany({
    where: { type: ConversationType.CHANNEL, spaceId, members: { some: { userId } } },
    select: { id: true, name: true },
  })
  return new Map(channels.map((c) => [c.id, c.name?.trim() || 'channel']))
}

export async function listLibrary(
  spaceId: string,
  viewer: { userId: string; email?: string | null },
  query: LibraryQuery,
): Promise<LibraryPage> {
  const before = query.before ? new Date(query.before) : null
  const olderThan = before && !Number.isNaN(before.getTime()) ? { lt: before } : undefined
  const wantFiles = query.filter !== 'links'
  const wantLinks = query.filter !== 'files'

  const [channels, nodes, lens] = await Promise.all([
    readableChannels(spaceId, viewer.userId, viewer.email),
    getSpaceNodes(spaceId),
    resourceViewer(spaceId, viewer.userId, viewer.email),
  ])
  const channelIds = [...channels.keys()]
  const resourceNodes = nodes.filter((n) => n.type.toLowerCase() === 'resource')
  const nodeByFile = new Map<string, NBNode>()
  for (const node of resourceNodes) {
    const fileId = fileIdOf(node.metadata)
    if (fileId) nodeByFile.set(fileId, node)
  }

  const [files, shares] = await Promise.all([
    wantFiles
      ? prisma.resource.findMany({
          where: { AND: [{ spaceId, source: 'upload', createdAt: olderThan }, visibleResourceWhere(lens)] },
          orderBy: { createdAt: 'desc' },
          take: PER_SOURCE,
          select: {
            id: true, name: true, fileType: true, fileSize: true, uploadedBy: true, createdAt: true, gcsPath: true,
            shares: { select: { conversationId: true }, orderBy: { createdAt: 'desc' } },
          },
        })
      : Promise.resolve([]),
    wantLinks && channelIds.length
      ? prisma.messageLinkPreview.findMany({
          where: {
            createdAt: olderThan,
            message: { conversationId: { in: channelIds }, deletedAt: null },
          },
          orderBy: { createdAt: 'desc' },
          take: PER_SOURCE,
          select: {
            createdAt: true,
            linkPreview: true,
            message: { select: { conversationId: true, sender: { select: { name: true } } } },
          },
        })
      : Promise.resolve([]),
  ])

  const linkNodes = wantLinks
    ? resourceNodes.filter((n) => !fileIdOf(n.metadata) && isHttpUrl(n.url) && (!before || iso(n.createdAt) < before.toISOString()))
    : []
  const [uploaders, cached] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: [...new Set(files.map((f) => f.uploadedBy))] } },
      select: { id: true, name: true },
    }),
    linkNodes.length
      ? prisma.linkPreview.findMany({ where: { url: { in: linkNodes.map((n) => n.url!) } } })
      : Promise.resolve([]),
  ])
  const nameOf = new Map(uploaders.map((u) => [u.id, u.name ?? null]))
  const previewOf = new Map(cached.map((p) => [p.url, p]))
  const channelOf = (id: string | null) => (id && channels.has(id) ? { id, name: channels.get(id)! } : null)

  const items: LibraryItem[] = []

  for (const file of files) {
    const node = nodeByFile.get(file.id)
    const raw = file.gcsPath ? resourceRawPath(file.id) : null
    const inSpace = file.shares.some((share) => share.conversationId === null)
    const channelId = file.shares.find((share) => share.conversationId && channels.has(share.conversationId))?.conversationId ?? null
    items.push({
      key: `file:${file.id}`,
      kind: 'file',
      source: inSpace ? 'drive' : 'channel',
      name: node?.name ?? file.name,
      fileType: file.fileType,
      fileSize: file.fileSize,
      url: raw,
      thumbUrl: file.fileType === 'image' ? raw : null,
      faviconUrl: null,
      siteName: null,
      description: node?.subtitle ?? null,
      href: node ? `/directory/${encodeURIComponent(node.id)}` : `/resources/${encodeURIComponent(file.id)}`,
      addedBy: nameOf.get(file.uploadedBy) ?? null,
      channel: channelOf(channelId),
      shares: 0,
      createdAt: file.createdAt.toISOString(),
    })
  }

  for (const node of linkNodes) {
    const url = node.url!
    const preview = previewOf.get(url)
    items.push({
      key: linkKey(url),
      kind: 'link',
      source: 'added',
      name: node.name,
      fileType: null,
      fileSize: null,
      url,
      thumbUrl: node.image_url ?? preview?.imageUrl ?? null,
      faviconUrl: preview?.faviconUrl ?? null,
      siteName: preview?.siteName ?? hostOf(url),
      description: node.subtitle ?? preview?.description ?? null,
      href: `/directory/${encodeURIComponent(node.id)}`,
      addedBy: null,
      channel: null,
      shares: 0,
      createdAt: iso(node.createdAt),
    })
  }

  for (const share of shares) {
    const preview = share.linkPreview
    items.push({
      key: linkKey(preview.url),
      kind: 'link',
      source: 'channel',
      name: preview.title ?? hostOf(preview.url),
      fileType: null,
      fileSize: null,
      url: preview.url,
      thumbUrl: preview.imageUrl,
      faviconUrl: preview.faviconUrl,
      siteName: preview.siteName ?? hostOf(preview.url),
      description: preview.description,
      href: null,
      addedBy: share.message.sender.name ?? null,
      channel: channelOf(share.message.conversationId),
      shares: 1,
      createdAt: share.createdAt.toISOString(),
    })
  }

  if (wantFiles) {
    for (const node of nodes) {
      if (node.type.toLowerCase() !== 'event' || !node.image_url) continue
      const createdAt = iso(node.createdAt)
      if (before && createdAt >= before.toISOString()) continue
      items.push({
        key: `event:${node.id}`,
        kind: 'file',
        source: 'event',
        name: node.name,
        fileType: 'image',
        fileSize: null,
        url: node.image_url,
        thumbUrl: node.image_url,
        faviconUrl: null,
        siteName: null,
        description: null,
        href: `/directory/${encodeURIComponent(node.id)}`,
        addedBy: null,
        channel: null,
        shares: 0,
        createdAt,
      })
    }
  }

  return foldLibrary(items, { filter: query.filter, q: query.q })
}
