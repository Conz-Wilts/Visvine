// Placed folders: the pure rules.
//
// A space's built-in folders — `people/`, `agents/`, `connectors/` and the rest
// of lib/notes/shared/namespaces.ts — and the folders its sub-spaces are read
// through (`subspaces/<id>`, under one `Sub-spaces` folder) have paths the
// runtime resolves against: `agents/<name>/index.md` is what makes something
// an agent, `[[Name]]` resolves to `people/<slug>`, every write gate and every
// feature toggle keys on the first segment. They cannot be renamed. They CAN
// be organised: a structural folder is PLACED — drawn under a folder of the
// space's own — and its path does not change. The tree draws structure; the
// path decides what may be written (the rule graftSubspace already runs on).
//
// Where a placement lives: on the index note of the folder that holds it.
//
//   ---
//   title: Ops
//   holds: [agents, subspaces/design-partners]
//   ---
//
// The container's own note, because the placement IS a fact about that folder
// ("ops holds the agents"): it is written under the container's own edit gate,
// it follows the container through a rename and through the trash, it is
// hand-editable and agent-legible, and the tree route already reads every
// index note's frontmatter, so reading it costs nothing. The root holds by
// default and records nothing — placing a folder "at the top" is removing it
// from whoever held it.
//
// What the placement changes: the tree, and only the tree. Note paths, URLs,
// the note index, search, the index child blocks (`<!-- index:children -->`,
// which list what is filed under a folder BY PATH) — all unchanged.
//
// The rules a placement obeys, each a sentence:
//   - a structural folder sits in a folder of the space's own or at the top —
//     never inside another structural folder, an entity's folder, or what
//     the parent shares (`parent/`);
//   - it stays in its own space: a sub-space's `agents/` is placed within the
//     sub-space, this space's within this space, and a sub-space's FOLDER
//     (`subspaces/<id>`) is a folder of the parent's tree;
//   - it is never placed inside itself, by path or by drawing.
//
// Pure and client-safe: the sidebar decides what may be dragged where with the
// same code the route refuses with.

import { namespaceOf } from './namespaces'
import { folderOfIndexPath, isIndexPath } from './indexNote'
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from './markdown'
import type { NoteFrontmatter, NoteMeta, TreeNode } from './types'
import type { IconName } from '../../icons/names'
import {
  PARENT_FOLDER,
  SUBSPACE_FOLDER,
  SUBSPACES_TITLE,
  isParentPath,
  parentWriteDenial,
  parseSubspacePath,
} from '../../spaces/subspaces'

/** The frontmatter key on a folder's index note naming what it holds. */
const HOLDS_KEY = 'holds'

/**
 * What a placeable path is: `space` is the sub-space whose own folder it is
 * (null for this space's), `folder` its path inside that space. A sub-space's
 * folder itself — `subspaces/<id>` — is a folder of the PARENT's tree.
 */
export interface Placeable {
  space: string | null
  folder: string
}

/**
 * Whether a path names a folder that is placed rather than moved, and whose:
 * a namespace dir exactly (`agents`, `subspaces`, never `parent`), a
 * sub-space's folder, or a namespace dir inside a sub-space. Everything else —
 * a custom folder, an entity's folder, a note — moves by path as it always has.
 */
export function placeableOf(path: string): Placeable | null {
  if (!path || isParentPath(path)) return null
  const sub = parseSubspacePath(path)
  if (sub) {
    if (!sub.path) return { space: null, folder: path }
    const ns = namespaceOf(sub.path)
    if (!ns || ns.dir !== sub.path || ns.dir === PARENT_FOLDER || ns.dir === SUBSPACE_FOLDER) return null
    return { space: sub.spaceId, folder: sub.path }
  }
  const ns = namespaceOf(path)
  return ns && ns.dir === path && ns.dir !== PARENT_FOLDER ? { space: null, folder: path } : null
}

/** The drawn path of each node's parent — the tree as the sidebar shows it. */
function drawnParents(root: TreeNode): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (node: TreeNode) => {
    for (const child of node.children ?? []) {
      out.set(child.path, node.path)
      walk(child)
    }
  }
  walk(root)
  return out
}

/** The folder a path is DRAWN under (`''` = the root), or null when the tree does not show it. */
export function drawnParentOf(root: TreeNode, path: string): string | null {
  return drawnParents(root).get(path) ?? null
}

/**
 * Why `item` cannot be placed in `dest` (a drawn folder path, `''` = the top),
 * or null when it can. Pass the tree to add the drawn-ancestry cycle check;
 * without it the path rules alone answer. Says nothing about whether the
 * placement is a change — the caller compares against `drawnParentOf`.
 */
export function placementDenial(item: string, dest: string, tree?: TreeNode): string | null {
  const placed = placeableOf(item)
  if (!placed) return `"${item}" is moved, not placed — only a built-in folder or a sub-space is placed.`
  if (isParentPath(dest)) return parentWriteDenial(dest)
  const isRoom = placed.space === null && item !== SUBSPACE_FOLDER && parseSubspacePath(item) !== null
  // A room's folder has two homes: the `Sub-spaces` folder (its default, which
  // is "no record") or a folder of the parent's own. Never the bare top.
  if (isRoom && dest === SUBSPACE_FOLDER) return null
  if (isRoom && dest === '') return `A sub-space sits in "${SUBSPACES_TITLE}", or in a folder of your own.`
  // Which space `dest` is in: a room's own folders sit inside the room
  // (`subspaces/x/…`, and `subspaces/x` itself is the room's top); everything
  // else, the room folders included, is the parent's.
  const destSub = parseSubspacePath(dest)
  const destSpace = destSub ? destSub.spaceId : null
  if (placed.space !== destSpace) {
    return 'A built-in folder is placed within its own space — a sub-space’s stays in that sub-space, and this space’s stays here.'
  }
  if (dest === item || dest.startsWith(`${item}/`)) return 'A folder can’t be placed inside itself.'
  const inner = destSub ? destSub.path : dest
  if (inner && namespaceOf(inner)) {
    return `"${dest}" is one of the space's built-in folders — a built-in folder sits in a folder of your own, or at the top.`
  }
  if (tree) {
    const parents = drawnParents(tree)
    for (let cur: string | undefined = dest; cur; cur = parents.get(cur)) {
      if (cur === item) return 'A folder can’t be placed inside itself.'
    }
  }
  return null
}

/** Whether a drop of `item` on `dest` would do anything (legal AND a real change). */
export function canPlaceInto(tree: TreeNode, item: string, dest: string): boolean {
  return placementDenial(item, dest, tree) === null && drawnParentOf(tree, item) !== dest
}

/** The `holds:` list of a folder's index note, as written — root-relative paths. */
export function holdsOf(frontmatter: NoteFrontmatter | null | undefined): string[] {
  const raw = frontmatter?.[HOLDS_KEY]
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
}

/** The same note with its `holds:` set (or removed when empty); body untouched. */
export function withHolds(content: string, holds: string[]): string {
  const fm = parseFrontmatter(content) as Record<string, unknown>
  const { body } = splitFrontmatter(content)
  const next: Record<string, unknown> = { ...fm }
  if (holds.length) next[HOLDS_KEY] = holds
  else delete next[HOLDS_KEY]
  return joinFrontmatter(next, body)
}

/**
 * Every placement a context's index notes declare: placed path → the folder
 * holding it. Read off one context's OWN notes, so entries are that context's
 * root-relative paths (`agents`, `subspaces/design-partners`). Two folders
 * claiming the same one is a hand edit gone astray, and the one with the
 * smaller path wins — deterministic, and the place route mends it on the next
 * placement by clearing every other claim.
 */
export function placementsFrom(metas: NoteMeta[]): Map<string, string> {
  const out = new Map<string, string>()
  const indexes = metas
    .filter((m) => isIndexPath(m.path))
    .sort((a, b) => a.path.localeCompare(b.path))
  for (const meta of indexes) {
    const container = folderOfIndexPath(meta.path)
    if (!container) continue
    for (const held of holdsOf(meta.frontmatter)) {
      // A room recorded as held by `subspaces` is a no-op hand edit: that is
      // where it sits anyway.
      if (out.has(held) || !placeableOf(held) || container === SUBSPACE_FOLDER) continue
      out.set(held, container)
    }
  }
  return out
}

/**
 * Draw the placements: move each placed node under its container, in place.
 * A placement that cannot be honoured — the container is gone, is not a
 * folder of the space's own, or would put the folder inside itself — is
 * skipped and the folder stays where its path puts it. Idempotent, so it can
 * run again after more of the tree has been grafted.
 */
export function applyPlacements(root: TreeNode, placements: ReadonlyMap<string, string>): void {
  for (const [placed, container] of placements) {
    const parents = drawnParents(root)
    const from = parents.get(placed)
    if (from === undefined) continue
    if (from === container) continue
    if (placementDenial(placed, container, root)) continue
    const target = container === '' ? root : findNode(root, container)
    if (!target || target.kind !== 'folder') continue
    const source = findNode(root, from)
    const node = source?.children?.find((c) => c.path === placed)
    if (!source?.children || !node) continue
    source.children = source.children.filter((c) => c !== node)
    target.children ??= []
    target.children.push(node)
  }
}

function findNode(root: TreeNode, path: string): TreeNode | null {
  if (path === '') return root
  for (const child of root.children ?? []) {
    if (child.path === path) return child
    if (child.kind === 'folder' && path.startsWith(`${child.path}/`)) {
      const hit = findNode(child, path)
      if (hit) return hit
    }
  }
  // A placed node is not under its path-parent any more, so the prefix walk
  // above can miss it; fall back to a full search.
  for (const child of root.children ?? []) {
    if (child.kind !== 'folder') continue
    const hit = findAnywhere(child, path)
    if (hit) return hit
  }
  return null
}

function findAnywhere(node: TreeNode, path: string): TreeNode | null {
  for (const child of node.children ?? []) {
    if (child.path === path) return child
    if (child.kind === 'folder') {
      const hit = findAnywhere(child, path)
      if (hit) return hit
    }
  }
  return null
}

/**
 * The glyph a structural folder is drawn with: its namespace row's, a
 * sub-space's the `blocks` mark. Null for an ordinary folder.
 */
export function structuralIconOf(path: string): IconName | null {
  const sub = parseSubspacePath(path)
  if (sub && !sub.path) return 'blocks'
  const inner = sub ? sub.path : path
  const ns = namespaceOf(inner)
  return ns && ns.dir === inner ? ns.icon : null
}

/**
 * True for a space's `people/` folder itself (a sub-space's included). The tree
 * draws it with the person silhouette every person row carries, so the folder
 * reads as the people it holds rather than as the Directory's grid mark.
 */
export function isPeopleFolder(path: string): boolean {
  const sub = parseSubspacePath(path)
  const inner = sub ? sub.path : path
  if (!inner) return false
  const ns = namespaceOf(inner)
  return !!ns && ns.dir === inner && ns.kind === 'person'
}
