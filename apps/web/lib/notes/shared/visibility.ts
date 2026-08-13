// The read model for the shared brain. filterVisible is applied BEFORE
// search/index/context building, so a link into a path the viewer can't read
// degrades to an unresolved link — no title leak. Grants at any folder depth
// and restricted cuts are all folded into principalCanRead (shared/authz.ts).
// Personal brains never pass through here (they are owner-only by brain
// scoping).

import type { BrainPrincipal } from './brainTypes'
import { principalCanRead } from './permissions'

/** Whether one shared-brain note path is visible to the principal. */
export function pathVisibleTo(path: string, p: BrainPrincipal): boolean {
  return principalCanRead(p, path)
}

/** The subset of items (anything carrying a brain path) the principal may read. */
export function filterVisible<T extends { path: string }>(items: T[], p: BrainPrincipal): T[] {
  if (p.system || p.spaceAdmin) return items
  return items.filter((item) => pathVisibleTo(item.path, p))
}
