// Which directory nodes a viewer may see at all. Pure.
//
// Most entities are shown to every member and only their NOTE may be private.
// A resource and a channel are different: their note's audience IS who may
// know they exist — a file shared only in #board, a private channel — so a
// node of those kinds is hidden wherever its entity folder is out of the
// viewer's reach (lib/resources/grants.ts writes that audience).

import { entityIndexPathOf, type EntityNodeLike } from '../entities'
import { effectiveLevel, isRestrictedPath, LEVEL_VIEW, type ContextAccess } from './authz'

/** The kinds whose existence is as private as their note. */
const MEMBERSHIP_KINDS = new Set(['resource', 'channel'])

export function isEntityHidden(node: EntityNodeLike, access: ContextAccess): boolean {
  if (!MEMBERSHIP_KINDS.has(node.type.toLowerCase())) return false
  const path = entityIndexPathOf(node)
  if (!path || !isRestrictedPath(access.restricted, path)) return false
  return effectiveLevel(access, path) < LEVEL_VIEW
}

export function withoutHiddenEntities<T extends EntityNodeLike>(nodes: T[], access: ContextAccess | null): T[] {
  if (!access) return nodes
  return nodes.filter((node) => !isEntityHidden(node, access))
}
