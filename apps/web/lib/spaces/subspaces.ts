// Sub-spaces: the pure rules (docs/sub-spaces.md). No database here, so the
// create route, the settings route, the tree route, the write gate and the
// tests all read one answer. The database side — which sub-spaces a space
// has, the principal a parent's member reads one through — is
// lib/spaces/subspaceAccess.ts and lib/notes/federation.ts.
//
// A sub-space is a full Space row that names its parent. It is its own tenant
// in every other respect: its own members, its own admins, its own tools,
// its own context. Two things tie it to the parent, and both are one level
// deep by rule:
//
//   - it is listed under the parent (the switcher, the console's Sub-spaces
//     section), and its visibility is its OWN — a public sub-space inside a
//     private space is discoverable and joinable, and a private sub-space
//     inside a public one is not;
//   - when it is PUBLIC, its context flows up: it appears in the parent's
//     context tree as the read-only folder `spaces/<id>/`, and whatever it
//     holds is read, listed and searched from there as of now. A private
//     sub-space shows nothing at the parent, not even its name.

import type { TreeNode } from '@/lib/notes/shared/types'
import { rewriteLinks } from '@/lib/notes/shared/linkRewrite'
import { splitFrontmatter } from '@/lib/notes/shared/markdown'

/**
 * The parent-side folder every sub-space is read through. Reserved: nothing
 * in a space's own context may be written under it (`subspaceWriteDenial`),
 * because what appears there is another space's context, rebased in.
 */
export const SUBSPACE_FOLDER = 'spaces'

/**
 * Why a sub-space cannot be created inside `parent`, or null when it can. One
 * level: a space that is itself a sub-space holds none. A personal space and
 * the global record are not places anything lives inside.
 */
export function parentDenial(parent: {
  parentId: string | null
  personalOwnerId: string | null
  isGlobal: boolean
}): string | null {
  if (parent.personalOwnerId) return 'A personal space cannot hold sub-spaces.'
  if (parent.isGlobal) return 'Visvine cannot hold sub-spaces.'
  if (parent.parentId) return 'A sub-space cannot hold sub-spaces — spaces nest one level deep.'
  return null
}

/** Whether a sub-space's context is read into its parent's: only a public one is. */
export function flowsUp(sub: { visibility: string | null }): boolean {
  return sub.visibility === 'public'
}

export function siblingNameTakenMessage(existingName: string, parentName: string): string {
  return `${parentName} already has a sub-space named "${existingName}". Choose a different name.`
}

/** The parent-side folder a sub-space's context is read through. */
export function subspaceFolderPath(subspaceId: string): string {
  return `${SUBSPACE_FOLDER}/${subspaceId}`
}

/** Whether a path is the `spaces/` folder or anything under it. */
export function isSubspacePath(path: string): boolean {
  return path === SUBSPACE_FOLDER || path.startsWith(`${SUBSPACE_FOLDER}/`)
}

/**
 * Split a parent-side path into the sub-space it reads and the path inside
 * that sub-space's own context. `spaces/<id>` (the folder itself) maps to the
 * sub-space's root, ''. Null for anything not under `spaces/<id>`.
 */
export function parseSubspacePath(path: string): { spaceId: string; path: string } | null {
  if (!path.startsWith(`${SUBSPACE_FOLDER}/`)) return null
  const rest = path.slice(SUBSPACE_FOLDER.length + 1)
  const slash = rest.indexOf('/')
  const spaceId = slash === -1 ? rest : rest.slice(0, slash)
  if (!spaceId) return null
  return { spaceId, path: slash === -1 ? '' : rest.slice(slash + 1) }
}

/** Rebase a path inside a sub-space's context onto the parent's tree. */
export function rebasePath(subspaceId: string, path: string): string {
  return path ? `${subspaceFolderPath(subspaceId)}/${path}` : subspaceFolderPath(subspaceId)
}

/**
 * Why nothing may be written at `path` in a space's own context, or null.
 * `spaces/` is where sub-spaces' context is READ; writing there would put a
 * note in the parent that looked like it belonged to a sub-space and was
 * governed by neither.
 */
export function subspaceWriteDenial(path: string): string | null {
  if (!isSubspacePath(path)) return null
  const parsed = parseSubspacePath(path)
  return parsed && parsed.path
    ? `"${SUBSPACE_FOLDER}/${parsed.spaceId}" is a sub-space's own context, shown here read-only. Write it in that space.`
    : `"${SUBSPACE_FOLDER}" holds the context of this space's public sub-spaces, read-only. Write in the sub-space itself.`
}

function rebaseNode(node: TreeNode, subspaceId: string): TreeNode {
  return {
    ...node,
    path: rebasePath(subspaceId, node.path),
    ...(node.children ? { children: node.children.map((c) => rebaseNode(c, subspaceId)) } : {}),
  }
}

/**
 * Graft a sub-space's own tree into the parent's, in place, as the folder
 * `spaces/<id>/`. The sub-space's root index becomes the folder's index —
 * `spaces/<id>/index.md` — so the folder row opens the sub-space's own home
 * note and carries its name; nothing of the parent's is under the folder
 * (`subspaceWriteDenial`), so nothing can collide. The folder is stamped
 * `space` so the sidebar can draw it as what it is.
 */
export function graftSubspace(root: TreeNode, sub: { id: string; name: string }, subRoot: TreeNode): TreeNode {
  root.children ??= []
  let holder = root.children.find((c) => c.kind === 'folder' && c.path === SUBSPACE_FOLDER)
  if (!holder) {
    holder = { name: SUBSPACE_FOLDER, path: SUBSPACE_FOLDER, kind: 'folder', title: 'Spaces', children: [] }
    root.children.push(holder)
  }
  const folder: TreeNode = {
    name: sub.id,
    path: subspaceFolderPath(sub.id),
    kind: 'folder',
    title: sub.name,
    space: sub.id,
    children: (subRoot.children ?? []).map((c) => rebaseNode(c, sub.id)),
  }
  holder.children ??= []
  holder.children.push(folder)
  return folder
}

/**
 * Rebase the paths a note index entry carries — its own, its folder, and the
 * notes it links to — so a sub-space's index reads correctly from the parent.
 * Links into the sub-space's own notes stay resolvable; nothing else changes.
 */
export function rebaseMeta<T extends { path: string; folder: string; linkTargets: string[] }>(
  meta: T,
  subspaceId: string,
): T {
  return {
    ...meta,
    path: rebasePath(subspaceId, meta.path),
    folder: meta.folder ? rebasePath(subspaceId, meta.folder) : subspaceFolderPath(subspaceId),
    linkTargets: meta.linkTargets.map((t) => rebasePath(subspaceId, t)),
  }
}

/**
 * Links in a sub-space's note point at that sub-space's own paths. Read from
 * the parent they have to point at the rebased ones, or a click on
 * `[Craig](/people/craig.md)` would look for the parent's Craig. Only the
 * body is touched; the frontmatter is the sub-space's and stays verbatim.
 */
export function rebaseNoteLinks(content: string, subspaceId: string, fromPath: string): string {
  const { frontmatter, body } = splitFrontmatter(content)
  const rebased = rewriteLinks(body, fromPath, (target) => rebasePath(subspaceId, target))
  if (frontmatter === null) return rebased
  return `---\n${frontmatter}\n---\n\n${rebased}`
}

/**
 * The trail a sub-space is shown under: `[parent, sub]`, or `[space]` for a
 * space with no parent (or whose parent the viewer cannot see).
 */
export function spaceTrail<T extends { id: string; parentId?: string | null }>(space: T, byId: Map<string, T>): T[] {
  const parent = space.parentId ? byId.get(space.parentId) : undefined
  return parent ? [parent, space] : [space]
}

/**
 * Group spaces into the branches the switcher draws: every top-level space in
 * the given order, each carrying the sub-spaces of it that are in the list. A
 * sub-space whose parent is not in the list stands on its own as a branch with
 * no children, where it would have been — the parent it names is not something
 * the viewer can see.
 *
 * The switcher draws each branch as a row, and its children under it on the
 * tree spine when the branch is opened.
 */
export function spaceBranches<T extends { id: string; parentId?: string | null }>(
  spaces: T[],
): Array<{ space: T; children: T[] }> {
  const ids = new Set(spaces.map((s) => s.id))
  const childrenOf = new Map<string, T[]>()
  const roots: T[] = []
  for (const s of spaces) {
    if (s.parentId && ids.has(s.parentId)) {
      childrenOf.set(s.parentId, [...(childrenOf.get(s.parentId) ?? []), s])
    } else {
      roots.push(s)
    }
  }
  return roots.map((space) => ({ space, children: childrenOf.get(space.id) ?? [] }))
}
