// The read model for the shared brain, ported from blackbird-brain's
// src/shared/visibility.ts. filterVisible is applied BEFORE search/index/graph
// building, so a link into a private folder the viewer can't read degrades to an
// unresolved link — no title leak. Personal brains never pass through here (they
// are owner-only by brain scoping).

import type { BrainPrincipal } from './brainTypes'
import { principalCanRead } from './permissions'
import { folderIdOfPath } from './placement'

/** Whether one shared-brain note path is visible to the principal. */
export function pathVisibleTo(path: string, p: BrainPrincipal): boolean {
  return principalCanRead(p, folderIdOfPath(path))
}

/** The subset of items (anything carrying a brain path) the principal may read. */
export function filterVisible<T extends { path: string }>(items: T[], p: BrainPrincipal): T[] {
  if (p.system || p.communityAdmin) return items
  return items.filter((item) => pathVisibleTo(item.path, p))
}
