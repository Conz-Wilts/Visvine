// Sub-space federation: how a child space's tree is grafted into its record
// folder in the parent (docs/sub-spaces.md).
//
// A sub-space is a full Space with its own context, so its record folder in the
// parent holds nothing unless somebody writes into it — which reads as a broken
// folder rather than the boundary it is. The tree route resolves each child for
// the caller and grafts its tree in here; this module is the pure half, so the
// rebasing rules are testable without a database.

import type { TreeNode } from './types'

/** Every folder in this tree that is a sub-space's record, outermost first. */
export function spaceFolders(node: TreeNode, out: TreeNode[] = []): TreeNode[] {
  if (node.space) out.push(node)
  for (const child of node.children ?? []) {
    if (child.kind === 'folder') spaceFolders(child, out)
  }
  return out
}

/**
 * One foreign node, rebased into this tree: its `path` is prefixed with the
 * record folder so it is unique HERE (the parent may have a `connectors/` of
 * its own), and `foreign` keeps where it really lives so the client can open it
 * in that space instead of looking for it in this one.
 */
function rebase(node: TreeNode, under: string, spaceId: string): TreeNode {
  return {
    ...node,
    path: `${under}/${node.path}`,
    foreign: { spaceId, path: node.path },
    ...(node.children ? { children: node.children.map((c) => rebase(c, under, spaceId)) } : {}),
  }
}

/**
 * Graft `childRoot`'s children into the record `folder`, in place.
 *
 * Two rules decide what does NOT come across:
 *   - the child context's own `index.md` — the record folder's home page here
 *     is the parent's own record note, and two of them would be one row the
 *     folder opens and one row beside it saying the same thing;
 *   - anything whose rebased path the parent already holds — a note the parent
 *     wrote under the record folder wins, because this is the parent's tree.
 */
export function graftForeign(folder: TreeNode, childRoot: TreeNode, spaceId: string): void {
  const taken = new Set((folder.children ?? []).map((c) => c.path))
  for (const child of childRoot.children ?? []) {
    if (child.kind === 'note' && child.path === 'index.md') continue
    const rebased = rebase(child, folder.path, spaceId)
    if (taken.has(rebased.path)) continue
    folder.children ??= []
    folder.children.push(rebased)
  }
}
