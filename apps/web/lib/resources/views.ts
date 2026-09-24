/**
 * Load resources as `ResourceView`s for one viewer: the rows, their creators,
 * and only the shares that reach the viewer (a private channel's share of a
 * file the viewer sees through #general is not listed). The rows must already
 * be ones the viewer may see — the list query and the gate decide that.
 */
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { canManageResource, shareReaches, type ResourceViewer } from './shared/visibility'
import { toResourceView, type ResourceView } from './shared/view'

export const VIEW_SELECT = {
  id: true,
  spaceId: true,
  name: true,
  kind: true,
  source: true,
  mimeType: true,
  fileSize: true,
  width: true,
  height: true,
  pageCount: true,
  gcsPath: true,
  url: true,
  provider: true,
  embedUrl: true,
  unfurl: true,
  previewPath: true,
  fetchState: true,
  createdAt: true,
  deletedAt: true,
  nodeId: true,
  indexState: true,
  sourcePath: true,
  createdBy: true,
  renditions: { select: { kind: true } },
  shares: {
    orderBy: { createdAt: 'desc' as const },
    select: {
      conversationId: true,
      messageId: true,
      createdAt: true,
      conversation: { select: { name: true } },
      sharer: { select: { name: true } },
    },
  },
} satisfies Prisma.ResourceSelect

type ViewRow = Prisma.ResourceGetPayload<{ select: typeof VIEW_SELECT }>

export async function viewsOf(rows: ViewRow[], viewer: ResourceViewer): Promise<ResourceView[]> {
  const creatorIds = [...new Set(rows.map((r) => r.createdBy).filter((id): id is string => !!id))]
  const creators = creatorIds.length
    ? await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true, image: true } })
    : []
  const creatorOf = new Map(creators.map((u) => [u.id, u]))
  return rows.map((row) => {
    const reaching = row.shares.filter((share) => viewer.admin || shareReaches(viewer, share))
    return toResourceView(row, {
      creator: row.createdBy ? (creatorOf.get(row.createdBy) ?? null) : null,
      sharedToSpace: row.shares.some((s) => s.conversationId === null),
      canManage: canManageResource(viewer, row),
      shares: reaching
        .filter((s) => s.conversationId !== null)
        .map((s) => ({
          channelId: s.conversationId,
          channelName: s.conversation?.name ?? null,
          messageId: s.messageId,
          at: s.createdAt.toISOString(),
          byName: s.sharer?.name ?? null,
        })),
    })
  })
}

export async function loadView(resourceId: string, viewer: ResourceViewer): Promise<ResourceView | null> {
  const row = await prisma.resource.findUnique({ where: { id: resourceId }, select: VIEW_SELECT })
  if (!row) return null
  return (await viewsOf([row], viewer))[0] ?? null
}
