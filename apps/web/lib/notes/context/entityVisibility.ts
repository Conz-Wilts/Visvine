/**
 * The DB side of `shared/entityVisibility.ts`: the viewer's access, or null
 * for an admin (who sees every node). Every read that hands a space's nodes to
 * a person goes through `visibleNodesFor`.
 */
import { isAdmin } from '@/lib/auth'
import { contextAccessFor } from '@/lib/notes/access'
import type { ContextAccess } from '@/lib/notes/shared/authz'
import { withoutHiddenEntities } from '@/lib/notes/shared/entityVisibility'
import type { EntityNodeLike } from '@/lib/notes/entities'

export async function entityLensFor(spaceId: string, userId: string, email?: string | null): Promise<ContextAccess | null> {
  if (await isAdmin(userId, spaceId, email)) return null
  return contextAccessFor(spaceId, userId)
}

export async function visibleNodesFor<T extends EntityNodeLike>(
  spaceId: string,
  userId: string,
  email: string | null | undefined,
  nodes: T[],
): Promise<T[]> {
  return withoutHiddenEntities(nodes, await entityLensFor(spaceId, userId, email))
}
