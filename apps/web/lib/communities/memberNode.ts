/**
 * Every ACTIVE member gets a connected person node in the community's
 * directory — the one rule all four member-add paths (space create, admin add,
 * invite approval, public self-join) now share. Before this helper only space
 * creation minted a node, so most members simply never appeared in the
 * directory of spaces they belonged to.
 *
 * Idempotent and best-effort: `syncEntityNode` re-finds the node by its
 * `metadata.userId` record key, the identity connect no-ops when the pair is
 * already linked, and a member whose node fails to appear is a degraded
 * directory, not a failed join.
 */

import prisma from '../prisma'
import { syncEntityNodeSafe } from '../notes/context/entityNodes'
import { findMemberNode, connectNodeToUserSafe } from '../identity/connection'
import type { Actor } from '../notes/store'

export async function ensureMemberNode(
  communityId: string,
  userId: string,
  actor?: Actor | null,
  /**
   * Person alias to stamp on a newly minted node — the chip the directory card
   * shows (`Node.alias`, see lib/notes/aliases.ts). Pass the alias the member
   * actually holds; space creation passes `Owner`, because the creator holds the
   * Owner UserAlias from the same transaction. Left alone for a node that is
   * already there: a member's chip is community-local and editable, and a
   * re-join must not overwrite it.
   */
  alias?: string | null,
): Promise<string | null> {
  // Already connected somewhere in this community — done, whatever the node is
  // named locally (renames are community-local and must survive re-joins).
  const existing = await findMemberNode(communityId, userId)
  if (existing) return existing.id

  const [person, user] = await Promise.all([
    prisma.person.findUnique({
      where: { userId },
      select: { name: true, subtitle: true, location: true, imageUrl: true, tags: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ])
  const name = person?.name?.trim() || user?.name?.trim()
  if (!name) return null

  // Node only (`skipNote`) — the Context tab stubs a missing profile note
  // locally and the first real save creates it.
  const sync = await syncEntityNodeSafe({
    communityId,
    type: 'person',
    name,
    recordId: userId,
    subtitle: person?.subtitle ?? null,
    location: person?.location ?? null,
    imageUrl: person?.imageUrl ?? null,
    tags: person?.tags ?? [],
    // undefined (not null) when no alias was asked for — syncEntityNode only
    // writes the column when the caller actually passed one.
    ...(alias ? { alias } : {}),
    skipNote: true,
    actor: actor ?? null,
  })
  if (!sync) return null

  await connectNodeToUserSafe(sync.nodeId, userId, {
    actorUserId: actor?.id === 'system' ? null : (actor?.id ?? null),
    reason: 'member joined',
  })
  return sync.nodeId
}
