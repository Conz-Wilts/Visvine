// The `[[` link picker's tree: a flat list of linkable things (notes, and the
// directory entities whose note may not exist yet) folded into folders by
// path, drawn the way the context sidebar draws the context. Pure.
//
// Folder-ness is the path, as everywhere: a folder's `index.md` is not a child
// of it but the folder itself, so picking the folder links its index. A folder
// holding nothing but its index — an entity folder, `people/aiko/` — is a
// single thing to a reader and is drawn as one leaf.

import { humanizeFolderName, INDEX_BASENAME } from './indexNote'

export interface PickerLeaf<T> {
  path: string
  title: string
  ref: T
}

export type PickerTreeNode<T> =
  | { kind: 'folder'; path: string; title: string; index: PickerLeaf<T> | null; children: PickerTreeNode<T>[] }
  | { kind: 'leaf'; leaf: PickerLeaf<T> }

interface Draft<T> {
  path: string
  index: PickerLeaf<T> | null
  folders: Map<string, Draft<T>>
  leaves: PickerLeaf<T>[]
}

const draftOf = <T>(path: string): Draft<T> => ({ path, index: null, folders: new Map(), leaves: [] })

/** Fold leaves into a tree. The first leaf at a path wins it. Folders sort
 *  before leaves, each alphabetically by what the row reads. */
export function buildPickerTree<T>(leaves: PickerLeaf<T>[]): PickerTreeNode<T>[] {
  const root = draftOf<T>('')
  const seen = new Set<string>()
  for (const leaf of leaves) {
    if (seen.has(leaf.path)) continue
    seen.add(leaf.path)
    const segments = leaf.path.split('/')
    const file = segments.pop()!
    let at = root
    for (const segment of segments) {
      const path = at.path ? `${at.path}/${segment}` : segment
      let next = at.folders.get(segment)
      if (!next) { next = draftOf<T>(path); at.folders.set(segment, next) }
      at = next
    }
    // The context root's own index is a note like any other at the top.
    if (file === INDEX_BASENAME && at !== root) at.index = leaf
    else at.leaves.push(leaf)
  }
  return finish(root)
}

function finish<T>(draft: Draft<T>): PickerTreeNode<T>[] {
  const folders: PickerTreeNode<T>[] = []
  const leaves: PickerTreeNode<T>[] = draft.leaves.map((leaf) => ({ kind: 'leaf', leaf }))
  for (const [segment, sub] of draft.folders) {
    const children = finish(sub)
    if (children.length === 0 && sub.index) leaves.push({ kind: 'leaf', leaf: sub.index })
    else if (children.length > 0 || sub.index) {
      folders.push({
        kind: 'folder',
        path: sub.path,
        title: sub.index?.title || humanizeFolderName(segment),
        index: sub.index,
        children,
      })
    }
  }
  const byTitle = (a: PickerTreeNode<T>, b: PickerTreeNode<T>) => titleOf(a).localeCompare(titleOf(b))
  return [...folders.sort(byTitle), ...leaves.sort(byTitle)]
}

export function titleOf<T>(node: PickerTreeNode<T>): string {
  return node.kind === 'folder' ? node.title : node.leaf.title
}

/** Keep what `matches` accepts and the folders on the way to it, and name the
 *  folders to open so every match is on screen. A folder that matches only by its
 *  own name keeps its whole subtree but stays shut — typing "p" must not spill
 *  every person under People. */
export function prunePickerTree<T>(
  nodes: PickerTreeNode<T>[],
  matches: (title: string) => boolean,
): { nodes: PickerTreeNode<T>[]; open: Set<string> } {
  const open = new Set<string>()
  const walk = (list: PickerTreeNode<T>[]): PickerTreeNode<T>[] => {
    const out: PickerTreeNode<T>[] = []
    for (const node of list) {
      if (node.kind === 'leaf') {
        if (matches(node.leaf.title)) out.push(node)
        continue
      }
      const children = walk(node.children)
      if (children.length > 0) open.add(node.path)
      if (children.length > 0) out.push({ ...node, children })
      else if (matches(node.title)) out.push(node)
    }
    return out
  }
  return { nodes: walk(nodes), open }
}

export interface PickerRow<T> {
  node: PickerTreeNode<T>
  /** One guide per ancestor level below the top: 'mid' draws a line through,
   *  'last' ends it. The row's own join is the last entry. */
  guides: Array<'mid' | 'last'>
  open: boolean
}

/** The rows on screen, top to bottom, with the guide each level draws. */
export function visiblePickerRows<T>(
  nodes: PickerTreeNode<T>[],
  isOpen: (path: string) => boolean,
  guides: Array<'mid' | 'last'> = [],
): PickerRow<T>[] {
  const rows: PickerRow<T>[] = []
  nodes.forEach((node, i) => {
    const own: Array<'mid' | 'last'> = [...guides, i === nodes.length - 1 ? 'last' : 'mid']
    const open = node.kind === 'folder' && isOpen(node.path)
    // The top level hangs from nothing, so its entry is never drawn.
    rows.push({ node, guides: own.slice(1), open })
    if (node.kind === 'folder' && open) rows.push(...visiblePickerRows(node.children, isOpen, own))
  })
  return rows
}
