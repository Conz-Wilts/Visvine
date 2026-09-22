// How deep the context tree draws before it drills in.
//
// Folders nest without limit, but every level indents its rows, so a narrow
// panel runs out of room for the names long before the tree runs out of
// levels. Rather than scroll sideways, the tree FOCUSES: once a row would sit
// deeper than the panel can draw it, the top of the tree is drawn from a
// deeper folder and every level above it folds into one `..` row, which steps
// back up a level at a time.
//
// Depth is counted in the DRAWN tree (after tierRoot and placed folders), not
// in a path's segments: a placed folder is drawn under a folder that is not
// its path-parent, and `Main` is a row with no segment of its own. Pure, so
// the rules are tested without a browser (tests/tree-focus.test.ts).

import type { TreeNode } from './types'

/** Horizontal step one level of nesting adds (TreeChrome's nested indent). */
const TREE_LEVEL_PX = 26
/** Where a top-level row's label starts, plus the row menu at the far end. */
const ROW_CHROME_PX = 70
/** The narrowest a label is allowed to get before the tree drills in. */
const MIN_LABEL_PX = 120
/** Never drill in shallower than this, whatever the width. */
const MIN_DEPTH = 3
/** Levels of context kept above a row the tree drilled in to show. */
const FOCUS_KEEP = 2

/** The deepest row (0 = the top row) a panel `width` px wide draws in full. */
export function maxRowDepthFor(width: number): number {
  return Math.max(MIN_DEPTH, Math.floor((width - ROW_CHROME_PX - MIN_LABEL_PX) / TREE_LEVEL_PX))
}

/**
 * The folders drawn above the row at `path`, root first — `[root, …, parent]`
 * — or null when the drawn tree has no such row. An index note is drawn AS its
 * folder, so its chain stops at that folder's parent.
 */
export function drawnChain(root: TreeNode, path: string): TreeNode[] | null {
  const walk = (node: TreeNode, above: TreeNode[]): TreeNode[] | null => {
    for (const child of node.children ?? []) {
      if (child.path === path) {
        const ownIndex = child.kind === 'note' && isOwnIndex(node, child.path)
        return ownIndex ? above : [...above, node]
      }
      if (child.kind !== 'folder') continue
      const hit = walk(child, [...above, node])
      if (hit) return hit
    }
    return null
  }
  if (root.path === path) return []
  return walk(root, [])
}

function isOwnIndex(folder: TreeNode, notePath: string): boolean {
  return notePath === (folder.path && folder.drawn !== 'main' ? `${folder.path}/index.md` : 'index.md')
}

/**
 * Where the tree should be focused so the row at the end of `chain` (the row
 * `chain` leads to, drawn `chain.length` deep) is drawn in full: null for the
 * whole tree, else the path of the folder to draw from — FOCUS_KEEP levels
 * above that row's parent, so it keeps a little of where it is.
 *
 * `focus` is where the tree is focused now. A row already inside it that fits
 * keeps the focus — pressing `..` must not be undone by the next click.
 */
export function focusFor(chain: TreeNode[], focus: string | null, maxDepth: number): string | null {
  const depth = chain.length
  const at = focus === null ? 0 : chain.findIndex((n) => n.path === focus)
  if (at !== -1 && depth - at <= maxDepth) return focus
  if (depth <= maxDepth) return null
  const top = depth - 1 - FOCUS_KEEP
  return top <= 0 ? null : chain[top].path
}

/** The focus one level up from `focus`, whose chain is `chain` (the focused
 *  folder's own ancestors): its parent, or the whole tree from the top. */
export function focusUp(chain: TreeNode[]): string | null {
  return chain.length <= 1 ? null : chain[chain.length - 1].path
}
