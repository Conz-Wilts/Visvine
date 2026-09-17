// The database side of the same-person link (lib/directory/shared/samePerson.ts):
// the family a node's space belongs to, every record there carrying the same
// identity, and which of those spaces the viewer actively belongs to.
import prisma from '@/lib/prisma'
import { pickSamePerson, type SamePersonRecord } from './shared/samePerson'

/**
 * The other records of `node`'s identity across its family that `userId`
 * can open. Empty for a node with no identity, a top-level space with no
 * rooms, or a viewer in none of the other spaces.
 */
export async function samePersonRecords(
  node: { id: string; spaceId: string; identityId: string | null },
  userId: string,
): Promise<SamePersonRecord[]> {
  if (!node.identityId) return []
  const space = await prisma.space.findUnique({ where: { id: node.spaceId }, select: { parentId: true } })
  if (!space) return []
  const house = space.parentId ?? node.spaceId
  const rooms = await prisma.space.findMany({ where: { parentId: house }, select: { id: true } })
  const family = [house, ...rooms.map((r) => r.id)].filter((id) => id !== node.spaceId)
  if (family.length === 0) return []
  const [rows, memberships] = await Promise.all([
    prisma.node.findMany({
      where: { spaceId: { in: family }, identityId: node.identityId },
      select: { id: true, spaceId: true, space: { select: { id: true, name: true, parentId: true } } },
      take: 50,
    }),
    prisma.spaceMember.findMany({
      where: { userId, spaceId: { in: family }, status: 'active' },
      select: { spaceId: true },
    }),
  ])
  const candidates = rows.flatMap((r) =>
    r.space ? [{ id: r.id, spaceId: r.spaceId ?? '', space: { id: r.space.id, name: r.space.name, parent_id: r.space.parentId } }] : [],
  )
  return pickSamePerson(node, candidates, new Set(memberships.map((m) => m.spaceId)))
}
