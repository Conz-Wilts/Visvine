// The read model for the shared context. filterVisible is applied BEFORE
// search/index/context building, so a link into a path the viewer can't read
// degrades to an unresolved link — no title leak. Grants at any folder depth
// and restricted cuts are all folded into principalCanRead (shared/authz.ts).
// Personal contexts never pass through here (they are owner-only by context
// scoping).

import type { ContextPrincipal } from './contextTypes'
import { principalCanRead } from './permissions'

/** Whether one shared-context note path is visible to the principal. */
export function pathVisibleTo(path: string, p: ContextPrincipal): boolean {
  return principalCanRead(p, path)
}

/** The subset of items (anything carrying a context path) the principal may read. */
export function filterVisible<T extends { path: string }>(items: T[], p: ContextPrincipal): T[] {
  if (p.system || p.spaceAdmin) return items
  return items.filter((item) => pathVisibleTo(item.path, p))
}
