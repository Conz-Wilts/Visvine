// Membership of a space, as one question the routes share.
import prisma from '@/lib/prisma'

/** Whether the user holds an ACTIVE membership in `spaceId`. */
export async function isActiveMemberOf(userId: string, spaceId: string): Promise<boolean> {
  const row = await prisma.spaceMember.findFirst({
    where: { userId, spaceId, status: 'active' },
    select: { id: true },
  })
  return row !== null
}
