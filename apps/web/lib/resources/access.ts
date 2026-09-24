/**
 * Who may read one resource's bytes is `visibility.ts#requireVisibleResource`
 * (a share reaching the reader, or an admin). This module keeps the other
 * gate: where a file may be dropped.
 */
import prisma from '@/lib/prisma'
import { ApiError } from '@/lib/api/route'

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
