// The Context explorer's row model: pure functions that turn the folder tree +
// note index + expansion/filter state into the flat array a virtualized list
// renders. No React, no DOM — unit-tested in tests/context-tree-model.test.ts.
//
// The flattening rules mirror NoteSidebar so the two surfaces agree:
//   - a folder's own index.md never renders as a child row (the folder row IS
//     the index) — the brain root included: its index.md folds into the
//     synthetic root row, so the community reads as the parent folder.
//   - recursion only descends into folders present in `openPaths`.
// On top of that the explorer adds pruning: when `keep` is set (a search or
// filter is active), a row survives only if its path is in the set — folders
// stay because the ancestor closure of every match was added to `keep`.

import type { TreeNode, TrashEntry } from '@/lib/notes/shared/types'
import type { ContextItem } from '@/features/notes/hooks/useContextBrowse'
import { ancestorChain, ROOT_PATH, TRASH_PATH } from '@/features/notes/hooks/useContextTreeState'

export interface TreeRow {
  /** Unique list key: the path for tree rows, sentinel-prefixed otherwise. */
  key: string
  kind: 'folder' | 'note' | 'section' | 'trash' | 'trash-entry'
  depth: number
  path: string
  /** Note rows: the browse item (title, tags, links, mtime…). */
  item?: ContextItem
  /** Trash-entry rows only. */
  trashEntry?: TrashEntry
  /** Folder and section rows: display name. */
  label?: string
  /** Folder rows: notes underneath (after pruning), recursive. */
  childCount?: number
  isOpen?: boolean
  /** The row itself matched the active search (highlight its title). */
  matched?: boolean
  /** Folder rows: the folder's index note path, when it has one. */
  indexPath?: string
}

export interface FlattenOptions {
  tree: TreeNode
  /** Note items keyed by path (index notes excluded, as useContextBrowse does). */
  itemsByPath: Map<string, ContextItem>
  /** Folders to descend into (effectiveOpenPaths, possibly force-expanded). */
  openPaths: Set<string>
  /** Paths that survive the active search/filters; null = everything shows. */
  keep: Set<string> | null
  /** Paths whose title should highlight as a search match. */
  matched?: Set<string> | null
  /** Starred note paths, rendered as a flat section above the tree. */
  starred?: string[]
  /** Trash entries, rendered as a pinned folder below the tree. */
  trash?: TrashEntry[] | null
  /** Label for the brain-root folder row. */
  rootLabel: string
}

/** All ancestor folders (root included) of every path in `paths` — union this
 *  with the match set so pruning never orphans a matched note. */
export function ancestorClosure(paths: Iterable<string>): Set<string> {
  const out = new Set<string>()
  for (const path of paths) for (const folder of ancestorChain(path)) out.add(folder)
  return out
}

/** The 1-hop link neighborhood of a note: itself, everything it links to, and
 *  everything that links to it. Powers the "connected to X" filter. */
export function neighborhoodOf(path: string, items: ContextItem[]): Set<string> {
  const out = new Set<string>([path])
  for (const item of items) {
    if (item.path === path) for (const target of item.linkTargets) out.add(target)
    else if (item.linkTargets.includes(path)) out.add(item.path)
  }
  return out
}

/** A folder node's own index note path — 'index.md' at the brain root. */
const indexOf = (node: TreeNode) => (node.path ? `${node.path}/index.md` : 'index.md')

/** Recursive count of kept notes under a folder node (its own index excluded). */
function countNotes(node: TreeNode, keep: Set<string> | null): number {
  let count = 0
  for (const child of node.children ?? []) {
    if (child.kind === 'note') {
      if (child.path === indexOf(node)) continue
      if (!keep || keep.has(child.path)) count++
    } else {
      count += countNotes(child, keep)
    }
  }
  return count
}

export function flattenVisibleRows(opts: FlattenOptions): TreeRow[] {
  const { tree, itemsByPath, openPaths, keep, matched, starred = [], trash = null, rootLabel } = opts
  const rows: TreeRow[] = []

  const pushNote = (path: string, depth: number, keyPrefix = '') => {
    const item = itemsByPath.get(path)
    if (!item) return
    rows.push({
      key: keyPrefix + path,
      kind: 'note',
      depth,
      path,
      item,
      matched: matched?.has(path) ?? false,
    })
  }

  const starredKept = starred.filter((p) => itemsByPath.has(p) && (!keep || keep.has(p)))
  if (starredKept.length > 0) {
    rows.push({ key: ':starred:', kind: 'section', depth: 0, path: ':starred:', label: 'Starred' })
    for (const path of starredKept) pushNote(path, 0, 'starred:')
  }

  const walk = (node: TreeNode, depth: number) => {
    for (const child of node.children ?? []) {
      if (child.kind === 'note') {
        // A folder's own index note folds into the folder row — the root's
        // index.md folds into the synthetic root row below.
        if (child.path === indexOf(node)) continue
        if (keep && !keep.has(child.path)) continue
        pushNote(child.path, depth)
      } else {
        if (keep && !keep.has(child.path)) continue
        const childCount = countNotes(child, keep)
        // Filters hide folders with nothing left in them (a search's ancestor
        // closure keeps the matched chain alive, so this only drops dead ends).
        if (keep && childCount === 0) continue
        const isOpen = openPaths.has(child.path)
        const indexPath = `${child.path}/index.md`
        rows.push({
          key: child.path,
          kind: 'folder',
          depth,
          path: child.path,
          label: child.title ?? child.name,
          childCount,
          isOpen,
          indexPath: (child.children ?? []).some((c) => c.kind === 'note' && c.path === indexPath)
            ? indexPath
            : undefined,
        })
        if (isOpen) walk(child, depth + 1)
      }
    }
  }

  const rootOpen = openPaths.has(ROOT_PATH)
  rows.push({
    key: ':root:',
    kind: 'folder',
    depth: 0,
    path: ROOT_PATH,
    label: rootLabel,
    childCount: countNotes(tree, keep),
    isOpen: rootOpen,
    // The brain-root index (the community's hand-written home page) rides the
    // root row exactly like any folder's index rides its folder row.
    indexPath: (tree.children ?? []).some((c) => c.kind === 'note' && c.path === 'index.md')
      ? 'index.md'
      : undefined,
  })
  if (rootOpen) walk(tree, 1)

  if (trash) {
    const trashOpen = openPaths.has(TRASH_PATH)
    rows.push({
      key: TRASH_PATH,
      kind: 'trash',
      depth: 0,
      path: TRASH_PATH,
      label: 'Trash',
      childCount: trash.length,
      isOpen: trashOpen,
    })
    if (trashOpen) {
      for (const entry of trash) {
        rows.push({
          key: `trash:${entry.id}`,
          kind: 'trash-entry',
          depth: 1,
          path: entry.path,
          trashEntry: entry,
        })
      }
    }
  }

  return rows
}
