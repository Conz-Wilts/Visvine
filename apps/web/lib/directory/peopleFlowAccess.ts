// The database side of the people flow: who may read a room's node through
// the house. Mirrors lib/eventAuth.ts#requireSpaceMemberOrParent for events —
// a node of a room whose `flowPeople` is on is readable by an ACTIVE member of
// the room's parent, and only for a read. Nothing here opens a write: the
// node PATCH keeps its own-space gate, and the house's directory shows the
// row read-only.
import prisma from '@/lib/prisma'
import { flowsPeople } from '@/lib/spaces/subspaces'
import { DIAL_SELECT } from '@/lib/spaces/subspaceAccess'
import type { ViaSpace } from './peopleFlow'

/**
 * The room a node of `spaceId` is read through by `userId`, or null when the
 * space is not a people-flowing room of a space they actively belong to.
 */
export async function peopleFlowReadThrough(spaceId: string, userId: string): Promise<ViaSpace | null> {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { id: true, name: true, personalOwnerId: true, ...DIAL_SELECT },
  })
  if (!space?.parentId || space.personalOwnerId || !flowsPeople(space)) return null
  const standing = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId, spaceId: space.parentId } },
    select: { status: true },
  })
  if (standing?.status !== 'active') return null
  return { id: space.id, name: space.name }
}
