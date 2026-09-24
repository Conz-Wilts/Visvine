// The channels of one space a person is in — the standing a `channel` grant
// keys on (lib/notes/access.ts) and a resource's shares are read against
// (lib/resources/visibility.ts). One indexed read, memoized per request.
import prisma from '@/lib/prisma'
import { requestMemo } from '@/lib/requestMemo'

export const memberChannelIds = requestMemo(
  'memberChannelIds',
  async (spaceId: string, userId: string): Promise<string[]> => {
    const rows = await prisma.conversationMember.findMany({
      where: { userId, conversation: { spaceId, type: 'CHANNEL' } },
      select: { conversationId: true },
    })
    return rows.map((row) => row.conversationId)
  },
)
