// The top of the context tree: the space, then what it holds.
//
// A space's own context and the rooms read into it are two different things
// that the tree used to draw as one — the space's folders at the top level and
// the rooms nested inside a `Sub-spaces` folder beside them, so a room read as
// a folder of this space's rather than another space. Here the root is drawn in
// tiers instead:
//
//   Visvine          the space (the root row)
//     Main           everything this space holds — its own context
//     Finance        a room, read into this tree
//     HR
//
// `Main` is DRAWN, never stored: it carries the reserved path `:main:` (a `:`
// prefix is not a note path — sanitizePath strips it, the same trick TRASH_PATH
// uses) and stands for the context root, so the space's own `index.md` folds
// into its row exactly as it folded into the root's. Nothing here changes a
// note's address; `subspaces/<id>/` is still where a room's context lives.

import { PARENT_FOLDER, SUBSPACE_FOLDER } from '@/lib/spaces/subspaces'
import type { TreeNode } from './types'

/** The drawn `Main` row's expansion key. Never a note path. */
export const MAIN_PATH = ':main:'
export const MAIN_TITLE = 'Main'

/**
 * Draw `root` in tiers: `Main` holding the space's own context, then one row
 * per room. Returns the root unchanged when there is no room at the top level
 * to lift — a space with no sub-spaces has one tier, so it gets no `Main` row,
 * and a `Sub-spaces` folder a space has PLACED under a folder of its own
 * (lib/notes/shared/placedFolders.ts) stays where it was put.
 */
export function tierRoot(root: TreeNode): TreeNode {
  const children = root.children ?? []
  const rooms = children.find((c) => c.path === SUBSPACE_FOLDER)
  if (!rooms || !(rooms.children ?? []).length) return root
  // `parent/` rides with the rooms: it is the other space read into this one,
  // and the tier it belongs to is theirs, not Main's.
  const own = children.filter((c) => c.path !== SUBSPACE_FOLDER && c.path !== PARENT_FOLDER)
  const shared = children.filter((c) => c.path === PARENT_FOLDER)
  const main: TreeNode = {
    name: MAIN_TITLE,
    path: MAIN_PATH,
    kind: 'folder',
    title: MAIN_TITLE,
    drawn: 'main',
    children: own,
  }
  return {
    ...root,
    // The rooms keep the `federated` stamp the `Sub-spaces` folder carried, so
    // they sort below Main and the tree draws its tier seam above the first of
    // them (context.ts#sortTree, NoteSidebar#TierSeam).
    children: [main, ...(rooms.children ?? []).map((r) => ({ ...r, federated: true })), ...shared],
  }
}
