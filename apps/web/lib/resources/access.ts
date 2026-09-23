/**
 * Who may read one Drive file's bytes: an active member of its space — and,
 * for a file dropped into a channel, a member of that channel, the same
 * standing that reads the message carrying it.
 */
import prisma from '@/lib/prisma'
import { ApiError } from '@/lib/api/route'
import { spaceMemberForbidden } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/session'

export async function requireReadableResource(resourceId: string, userId: string, email?: string | null) {
  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { id: true, spaceId: true, gcsPath: true, conversationId: true, name: true, metadata: true },
  })
  if (!resource) throw new ApiError(404, 'Not found')
  if (isSuperAdmin(email)) return resource
  if (await spaceMemberForbidden(userId, resource.spaceId, email)) throw new ApiError(404, 'Not found')
  if (resource.conversationId) {
    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: resource.conversationId, userId } },
      select: { id: true },
    })
    if (!member) throw new ApiError(404, 'Not found')
  }
  return resource
}

/**
 * Throws unless `conversationId` is a channel of `spaceId` that `userId` is in —
 * the place a file dropped into it may land.
 */
export async function requireChannelOfSpace(conversationId: string, spaceId: string, userId: string): Promise<void> {
  const member = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { conversation: { select: { type: true, spaceId: true } } },
  })
  if (!member || member.conversation.type !== 'CHANNEL' || member.conversation.spaceId !== spaceId) {
    throw new ApiError(403, 'You can only add files to a channel you are in')
  }
}
