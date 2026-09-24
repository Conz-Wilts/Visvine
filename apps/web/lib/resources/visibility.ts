/**
 * The DB side of resource visibility (the rule is `shared/visibility.ts`):
 * who the viewer is in a space, the one-row check every byte door runs, and the
 * same rule as a Prisma filter for lists — an EXISTS over the shares, one
 * indexed probe per row.
 */
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { ApiError } from '@/lib/api/route'
import { isAdmin, spaceMemberForbidden } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/session'
import { memberChannelIds } from '@/lib/messages/channelMembership'
import { canSeeResource, type ResourceViewer } from './shared/visibility'

export async function resourceViewer(
  spaceId: string,
  userId: string,
  email?: string | null,
): Promise<ResourceViewer> {
  if (isSuperAdmin(email)) return { userId, admin: true, member: true, channelIds: new Set() }
  const [admin, forbidden, channelIds] = await Promise.all([
    isAdmin(userId, spaceId, email),
    spaceMemberForbidden(userId, spaceId, email),
    memberChannelIds(spaceId, userId),
  ])
  return { userId, admin, member: !forbidden, channelIds: new Set(channelIds) }
}

/**
 * The visibility rule as a filter over `resources`. Deleted rows are excluded
 * unless `trash` asks for them, and then only the viewer's own (or every one,
 * for an admin).
 */
export function visibleResourceWhere(
  viewer: ResourceViewer,
  { trash = false }: { trash?: boolean } = {},
): Prisma.ResourceWhereInput {
  if (trash) {
    return viewer.admin ? { deletedAt: { not: null } } : { deletedAt: { not: null }, createdBy: viewer.userId }
  }
  const live: Prisma.ResourceWhereInput = { deletedAt: null, state: { not: 'deleted' } }
  if (viewer.admin) return live
  if (!viewer.member) return { id: { in: [] } }
  const reach: Prisma.ResourceShareWhereInput[] = [{ conversationId: null }]
  if (viewer.channelIds.size) reach.push({ conversationId: { in: [...viewer.channelIds] } })
  return {
    ...live,
    OR: [{ createdBy: viewer.userId, shares: { none: {} } }, { shares: { some: { OR: reach } } }],
  }
}

const GATE_SELECT = {
  id: true,
  spaceId: true,
  name: true,
  gcsPath: true,
  mimeType: true,
  kind: true,
  source: true,
  url: true,
  metadata: true,
  createdBy: true,
  deletedAt: true,
  scanState: true,
  shares: { select: { conversationId: true } },
} satisfies Prisma.ResourceSelect

export type GatedResource = Prisma.ResourceGetPayload<{ select: typeof GATE_SELECT }> & {
  viewer: ResourceViewer
}

/**
 * One resource the caller may see, or a 404 that says nothing about whether
 * it exists. Every byte door (`/raw`, `/thumb`, `/preview`) and every action
 * reading one resource goes through here. `trash` lets a deleted resource
 * through to the people who may restore it.
 */
export async function requireVisibleResource(
  resourceId: string,
  userId: string,
  email?: string | null,
  { trash = false }: { trash?: boolean } = {},
): Promise<GatedResource> {
  const resource = await prisma.resource.findUnique({ where: { id: resourceId }, select: GATE_SELECT })
  if (!resource) throw new ApiError(404, 'Not found')
  const viewer = await resourceViewer(resource.spaceId, userId, email)
  const deleted = resource.deletedAt !== null
  if (deleted && !trash) throw new ApiError(404, 'Not found')
  if (!canSeeResource(viewer, { createdBy: resource.createdBy, deleted, shares: resource.shares })) {
    throw new ApiError(404, 'Not found')
  }
  return { ...resource, viewer }
}
