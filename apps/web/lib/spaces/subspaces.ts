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
//   - when it is listed and `flowContext` is on, its context flows up: it
//     appears in the parent's context tree as a top-level folder (addressed
//     under the reserved `subspaces/<id>/`), and whatever it holds is read,
//     listed and searched from there as of now. Through that folder a person
//     is who they are in the sub-space: a member of it reads and writes as
//     themselves (lib/notes/federation.ts#writeTarget), everyone else reads
//     what it shows all of its members. A private sub-space shows nothing at
//     the parent but its name (a locked folder).
//
// And two things flow the other way, each only where the parent says so:
//
//   - a parent's connector or agent note marked `share: subspaces` is read
//     into every sub-space as a read-only top-level folder addressed under the
//     reserved `parent/` (`graftParent`) — the note's flag is the whole grant;
//   - a room decides who sees it (`listing`), who walks in (two `doors`),
//     what flows up (`flowContext` / `flowEvents`) and whether
//     the parent's admins hold its keys (`parentAdmins`) — the four dials.

import type { TreeNode } from '@/lib/notes/shared/types'
import { rewriteLinks } from '@/lib/notes/shared/linkRewrite'
import { splitFrontmatter } from '@/lib/notes/shared/markdown'
import { connectorHomeDenial, declaredConfigKind } from '@/lib/notes/shared/configKinds'
import type { NoteFrontmatter } from '@/lib/notes/shared/types'

/**
 * The path prefix every sub-space is addressed under in its parent, and the
 * one `Sub-spaces` folder the tree draws them in (`ensureSubspacesFolder`),
 * one level under the space. Reserved: nothing of the parent's OWN is ever
 * stored under it (`subspaceWriteDenial`) — a write there is a write in the
 * sub-space, hopped across by `federation.ts#writeTarget`. The folder, and
 * each room's folder in it, can be PLACED under a folder of the parent's own
 * for organisation (lib/notes/shared/placedFolders.ts); the address never moves.
 */
export const SUBSPACE_FOLDER = 'subspaces'
export const SUBSPACES_TITLE = 'Sub-spaces'

/**
 * The `Sub-spaces` folder in a parent's tree, created on first use: a folder
 * row at the reserved address, no `space` stamp (it is nobody's context), a
 * room's folder per child. Drawn only when there is a room to draw.
 */
export function ensureSubspacesFolder(root: TreeNode): TreeNode {
  root.children ??= []
  const existing = root.children.find((c) => c.path === SUBSPACE_FOLDER)
  if (existing) return existing
  const folder: TreeNode = { name: SUBSPACE_FOLDER, path: SUBSPACE_FOLDER, kind: 'folder', title: SUBSPACES_TITLE, federated: true, children: [] }
  root.children.push(folder)
  return folder
}

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

export function siblingNameTakenMessage(existingName: string, parentName: string): string {
  return `${parentName} already has a sub-space named "${existingName}". Choose a different name.`
}

/** The parent-side folder a sub-space's context is read through. */
export function subspaceFolderPath(subspaceId: string): string {
  return `${SUBSPACE_FOLDER}/${subspaceId}`
}

/** Whether a path is the `subspaces/` folder or anything under it. */
export function isSubspacePath(path: string): boolean {
  return path === SUBSPACE_FOLDER || path.startsWith(`${SUBSPACE_FOLDER}/`)
}

/**
 * Split a parent-side path into the sub-space it reads and the path inside
 * that sub-space's own context. `subspaces/<id>` (the folder itself) maps to the
 * sub-space's root, ''. Null for anything not under `subspaces/<id>`.
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
 * Why nothing may be stored at `path` in a space's OWN context, or null.
 * `subspaces/` is where sub-spaces' context appears; a note of the parent's
 * there would look like a sub-space's and be governed by neither. The routes
 * hop a write under `subspaces/<id>/` across to the sub-space before this is
 * asked (`federation.ts#writeTarget`), so the inner-path sentence is only
 * ever seen by a caller that did not — and the folder itself, and the
 * sub-space's root, are never written from here at all.
 */
export function subspaceWriteDenial(path: string): string | null {
  if (!isSubspacePath(path)) return null
  const parsed = parseSubspacePath(path)
  if (!parsed) return `"${SUBSPACE_FOLDER}" is where sub-spaces appear — nothing is written there directly.`
  if (!parsed.path) return 'This folder is the sub-space itself — rename or remove it from its own settings.'
  return 'This is a sub-space’s context — it is written in that space.'
}

// ─── Downward: what the parent shares ────────────────────────────────────────

/**
 * The path prefix a parent's shared notes are addressed under in each of its
 * sub-spaces — the mirror of `SUBSPACE_FOLDER`. One folder, drawn with the
 * parent's name, holding only the notes the parent flagged. Reserved the same
 * way: nothing of the sub-space's own may be written under it.
 */
export const PARENT_FOLDER = 'parent'

/** The frontmatter value that shares a note with every sub-space (`share: all`; `subspaces` is the older spelling). */
const SHARE_SUBSPACES = 'subspaces'
const SHARE_ALL = 'all'

/**
 * Who a note's `share:` reaches: every room (`all`), the rooms it names, or
 * nobody. Read off the frontmatter of a connector, agent or Tool note.
 */
export function shareTargets(frontmatter: Record<string, unknown> | null | undefined): 'all' | string[] | 'none' {
  const raw = frontmatter?.share
  if (raw === SHARE_ALL || raw === SHARE_SUBSPACES || raw === true) return 'all'
  if (typeof raw === 'string' && raw.trim()) {
    const list = raw.split(',').map((x) => x.trim()).filter(Boolean)
    return list.length ? list : 'none'
  }
  if (Array.isArray(raw)) {
    const list = raw.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
    return list.length ? list : 'none'
  }
  return 'none'
}

/**
 * Whether a note's frontmatter shares it down into `roomId`. Only what a room
 * borrows from the house can be shared — a note in `agents/` or `tools/`, or
 * a connector, which is the note declaring `type: connector` wherever the
 * house filed it (lib/notes/shared/configKinds.ts) — and only the note
 * carrying the flag, never a subtree. Without a room id: whether it is
 * shared with anyone at all.
 */
export function isSharedDown(path: string, frontmatter: Record<string, unknown> | null | undefined, roomId?: string): boolean {
  const slash = path.indexOf('/')
  const seg = slash === -1 ? path : path.slice(0, slash)
  const connector = declaredConfigKind(frontmatter as NoteFrontmatter | null | undefined) === 'connector' && connectorHomeDenial(path) === null
  if (seg !== 'connectors' && seg !== 'agents' && seg !== 'tools' && !connector) return false
  const targets = shareTargets(frontmatter)
  if (targets === 'none') return false
  return roomId === undefined ? true : reachesRoom(targets, roomId)
}

/** Whether a path is the `parent/` folder or anything under it. */
export function isParentPath(path: string): boolean {
  return path === PARENT_FOLDER || path.startsWith(`${PARENT_FOLDER}/`)
}

/** Whether a path is read from another space — a sub-space's or the parent's — and so never stored here. */
export function isFederatedPath(path: string): boolean {
  return isSubspacePath(path) || isParentPath(path)
}

/**
 * The sub-space a parent-side path belongs to, or null for the parent's own
 * paths, `parent/`, and the bare `subspaces` folder. The sub-space's root
 * folder (`subspaces/<id>`) counts as its own.
 */
export function subspaceOfPath(path: string): string | null {
  return parseSubspacePath(path)?.spaceId ?? null
}

/**
 * The path inside the parent's own context a sub-space-side path names:
 * `parent/connectors/x.md` → `connectors/x.md`, `parent` → ''. Null for
 * anything not under `parent/`.
 */
export function parseParentPath(path: string): string | null {
  if (path === PARENT_FOLDER) return ''
  if (!path.startsWith(`${PARENT_FOLDER}/`)) return null
  return path.slice(PARENT_FOLDER.length + 1)
}

/** Rebase a path inside the parent's context onto the sub-space's tree. */
export function rebaseParentPath(path: string): string {
  return path ? `${PARENT_FOLDER}/${path}` : PARENT_FOLDER
}

/**
 * Why nothing may be written at `path` in a sub-space's own context, or null:
 * `parent/` is where the parent's shared notes are READ. Change them in the
 * parent, where they live.
 */
export function parentWriteDenial(path: string): string | null {
  if (!isParentPath(path)) return null
  return `"${PARENT_FOLDER}" holds what the space this one sits inside shares with it, read-only. Change it in that space.`
}

/** Both reserved federated addresses in one answer, for the write gates. */
export function federatedWriteDenial(path: string): string | null {
  return subspaceWriteDenial(path) ?? parentWriteDenial(path)
}

function rebaseParentNode(node: TreeNode): TreeNode {
  return {
    ...node,
    path: rebaseParentPath(node.path),
    ...(node.children ? { children: node.children.map(rebaseParentNode) } : {}),
  }
}

/**
 * Graft the parent's shared notes into a sub-space's tree as one top-level
 * folder named after the parent — the mirror of `graftSubspace`. `sharedRoot`
 * is a tree built from the shared notes alone, so the folder holds
 * `connectors/` and `agents/` and nothing of the parent's that was not
 * flagged. Stamped `space` so the sidebar draws it as another space's, and
 * `parent` so it can say which way it flows.
 */
export function graftParent(root: TreeNode, parent: { id: string; name: string }, sharedRoot: TreeNode): TreeNode {
  const folder: TreeNode = {
    name: PARENT_FOLDER,
    path: PARENT_FOLDER,
    kind: 'folder',
    title: parent.name,
    space: parent.id,
    parent: true,
    federated: true,
    children: (sharedRoot.children ?? []).map(rebaseParentNode),
  }
  root.children ??= []
  root.children.push(folder)
  return folder
}

/** Rebase a shared parent note's index entry onto the sub-space's tree. */
export function rebaseParentMeta<T extends { path: string; folder: string; linkTargets: string[] }>(meta: T): T {
  return {
    ...meta,
    path: rebaseParentPath(meta.path),
    folder: meta.folder ? rebaseParentPath(meta.folder) : PARENT_FOLDER,
    linkTargets: meta.linkTargets.map(rebaseParentPath),
  }
}

/** Links in a shared parent note, read from the sub-space, point back under `parent/`. */
export function rebaseParentNoteLinks(content: string, fromPath: string): string {
  const { frontmatter, body } = splitFrontmatter(content)
  const rebased = rewriteLinks(body, fromPath, rebaseParentPath)
  if (frontmatter === null) return rebased
  return `---\n${frontmatter}\n---\n\n${rebased}`
}

// ─── The four dials (docs/sub-spaces.md) ─────────────────────────────────────

export type Listing = 'secret' | 'house' | 'world'
export type Door = 'invite' | 'ask' | 'open'
export const LISTINGS: readonly Listing[] = ['secret', 'house', 'world']
export const DOORS: readonly Door[] = ['invite', 'ask', 'open']
const DOOR_RANK: Record<Door, number> = { invite: 0, ask: 1, open: 2 }

export interface Dials {
  visibility: string | null
  parentId: string | null
  listing?: string | null
  houseDoor?: string | null
  worldDoor?: string | null
  flowContext?: boolean | null
  flowEvents?: boolean | null
}

export function asDoor(raw: unknown, fallback: Door): Door {
  return raw === 'invite' || raw === 'ask' || raw === 'open' ? raw : fallback
}

/**
 * Who can see a space exists. `visibility` is authoritative — world ⇔
 * public — so a public row is `world` whatever `listing` says; a private
 * row is `secret` when it says so, else `house` for a room and `secret` for
 * a top-level space (there is no house above it to list it to).
 */
export function listingOf(space: { visibility: string | null; parentId: string | null; listing?: string | null }): Listing {
  if (space.visibility === 'public') return 'world'
  if (!space.parentId) return 'secret'
  return space.listing === 'secret' ? 'secret' : 'house'
}

/** The `visibility` column a listing implies — the one every gate reads. */
export function visibilityForListing(listing: Listing): 'public' | 'private' {
  return listing === 'world' ? 'public' : 'private'
}

/**
 * The doors as they apply. The house door is meaningless on a secret room
 * (nobody can see it) and on a top-level space (no house); the world door
 * is meaningless unless listed to the world, and is clamped to the house
 * door on a room — a room never lets strangers in more easily than the
 * house's own members.
 */
export function doorsOf(space: Dials): { house: Door; world: Door } {
  const listing = listingOf(space)
  const house = asDoor(space.houseDoor, 'ask')
  const rawWorld = asDoor(space.worldDoor, 'open')
  const world = space.parentId ? (DOOR_RANK[rawWorld] > DOOR_RANK[house] ? house : rawWorld) : rawWorld
  return {
    house: space.parentId && listing !== 'secret' ? house : 'invite',
    world: listing === 'world' ? world : 'invite',
  }
}

export type SubspaceJoinOutcome = 'deny' | 'pending' | 'active'

/**
 * What pressing Join writes, for the audience the caller is in: a member of
 * the house goes through the house door, everyone else through the world
 * door. `invite` = deny (nothing to press), `ask` = a pending request an
 * admin of the space answers, `open` = active. Personal and global spaces
 * are refused before this is asked.
 */
export function joinOutcome(space: Dials & { personalOwnerId?: string | null }, parentStanding: string | null): SubspaceJoinOutcome {
  if (space.personalOwnerId) return 'deny'
  const doors = doorsOf(space)
  const inHouse = Boolean(space.parentId) && parentStanding === 'active'
  const door = inHouse ? (DOOR_RANK[doors.house] >= DOOR_RANK[doors.world] ? doors.house : doors.world) : doors.world
  return door === 'open' ? 'active' : door === 'ask' ? 'pending' : 'deny'
}

/** Whether the parent's members see this room's door (the band, the switcher, the tree). */
export function listedToHouse(space: { visibility: string | null; parentId: string | null; listing?: string | null }): boolean {
  return Boolean(space.parentId) && listingOf(space) !== 'secret'
}

/** What flows up: each the room's switch, and nothing from a secret room. */
export function flowsContext(space: Dials): boolean {
  return listedToHouse(space) && space.flowContext !== false
}
export function flowsEvents(space: Dials): boolean {
  return listedToHouse(space) && space.flowEvents !== false
}
/** Kept for the callers that meant "context flows": the same answer as flowsContext. */
export function flowsUp(space: Dials): boolean {
  return flowsContext(space)
}

/** Whether the parent's admins hold this space's keys too (lib/auth.ts#isAdmin). */
export function parentAdministers(space: { parentId?: string | null; parentAdmins?: boolean | null }): boolean {
  return Boolean(space.parentId && space.parentAdmins)
}

/**
 * The house's side of the wall, read off the JSON column: which rooms its
 * model keys reach. (A `hiddenFromBand` list once lived beside it, for a
 * band of sub-space cards the Directory no longer draws — sub-spaces are
 * reached from the switcher and the context tree, not the directory. A
 * stored list is ignored.)
 */
export interface SubspaceConfig {
  modelKeys: 'all' | string[]
}
export function subspaceConfigOf(raw: unknown): SubspaceConfig {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const mk = o.modelKeys
  return {
    modelKeys: mk === 'all' ? 'all' : Array.isArray(mk) ? mk.filter((x): x is string => typeof x === 'string') : [],
  }
}

/** Whether a house-side "share with" value reaches `roomId`. */
export function reachesRoom(share: 'all' | string[] | 'none' | null | undefined, roomId: string): boolean {
  if (share === 'all') return true
  return Array.isArray(share) && share.includes(roomId)
}

/**
 * Presets: the structures people build, as dial settings. Every field stays
 * editable afterwards; the preset only decides where the dials start.
 */
export interface Preset {
  key: string
  name: string
  blurb: string
  listing: Listing
  houseDoor: Door
  worldDoor: Door
  flowContext: boolean
  flowEvents: boolean
  parentAdmins: boolean
}
const PRESETS: readonly Preset[] = [
  { key: 'department', name: 'Department', blurb: 'A team inside the house. Anyone here walks in; everything flows up; the house’s admins manage it.', listing: 'house', houseDoor: 'open', worldDoor: 'invite', flowContext: true, flowEvents: true, parentAdmins: true },
  { key: 'programme', name: 'Programme', blurb: 'A cohort or accelerator run from here. Anyone can find it and ask to join; the house’s members walk in.', listing: 'world', houseDoor: 'open', worldDoor: 'ask', flowContext: true, flowEvents: true, parentAdmins: true },
  { key: 'committee', name: 'Committee', blurb: 'A room nobody else can see. Invite only; nothing flows up.', listing: 'secret', houseDoor: 'invite', worldDoor: 'invite', flowContext: false, flowEvents: false, parentAdmins: true },
  { key: 'council', name: 'Council', blurb: 'A room the house’s members can see and ask to join.', listing: 'house', houseDoor: 'ask', worldDoor: 'invite', flowContext: true, flowEvents: true, parentAdmins: true },
  { key: 'tenant', name: 'Tenant', blurb: 'Someone else’s space, hosted here. Invite only, autonomous; only its events show at the top.', listing: 'house', houseDoor: 'invite', worldDoor: 'invite', flowContext: false, flowEvents: true, parentAdmins: false },
  { key: 'topic', name: 'Topic room', blurb: 'A public room in an open network. Everyone walks in; everything flows up.', listing: 'world', houseDoor: 'open', worldDoor: 'open', flowContext: true, flowEvents: true, parentAdmins: true },
]
export function presetByKey(key: string | null | undefined): Preset | null {
  return PRESETS.find((p) => p.key === key) ?? null
}

function rebaseNode(node: TreeNode, subspaceId: string): TreeNode {
  return {
    ...node,
    path: rebasePath(subspaceId, node.path),
    ...(node.children ? { children: node.children.map((c) => rebaseNode(c, subspaceId)) } : {}),
  }
}

/**
 * Graft a sub-space's own tree into the parent's, in place, as a folder in
 * the `Sub-spaces` folder — one level under the space, beside the other
 * rooms. Its ADDRESS is the reserved `subspaces/<id>/`, which is also where it
 * is drawn: the tree draws structure, the path decides what may be written,
 * so nothing of the parent's can collide with it (`subspaceWriteDenial`). The sub-space's
 * root index becomes the folder's index — `subspaces/<id>/index.md` — so the
 * folder row opens the sub-space's own home note and carries its name. The
 * folder is stamped `space` so the sidebar can draw it as what it is, and
 * `writable` when the viewer stands in the sub-space — its rows then take
 * the same edit affordances as the space's own, and each write is judged in
 * the sub-space (lib/notes/federation.ts#writeTarget).
 */
export function graftSubspace(
  root: TreeNode,
  sub: { id: string; name: string },
  subRoot: TreeNode,
  writable = false,
): TreeNode {
  const folder: TreeNode = {
    name: sub.id,
    path: subspaceFolderPath(sub.id),
    kind: 'folder',
    title: sub.name,
    space: sub.id,
    ...(writable ? { writable: true } : {}),
    children: (subRoot.children ?? []).map((c) => rebaseNode(c, sub.id)),
  }
  ensureSubspacesFolder(root).children!.push(folder)
  return folder
}

/**
 * Drop the `Sub-spaces` folder when nothing is drawn in it — every room placed
 * elsewhere, or none to draw — wherever the folder itself is drawn. A folder
 * appears because there is something in it.
 */
export function pruneEmptySubspacesFolder(root: TreeNode): void {
  const walk = (node: TreeNode) => {
    if (!node.children) return
    node.children = node.children.filter((c) => !(c.path === SUBSPACE_FOLDER && (c.children ?? []).length === 0))
    for (const child of node.children) walk(child)
  }
  walk(root)
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

/**
 * The mark a space wears. A sub-space wears its PARENT's — one house, one
 * picture: a sub-space is a room of the space it names, and its own name is
 * what tells the two apart. It falls back to its own only when the parent is
 * not in the list the viewer can see, so a lone sub-space still shows
 * something rather than nothing.
 */
export function spaceMark<T extends { id: string; name: string; imageUrl?: string; parentId?: string | null }>(
  space: T,
  spaces: readonly T[],
): { name: string; imageUrl?: string } {
  const parent = space.parentId ? spaces.find((s) => s.id === space.parentId) : undefined
  const wearer = parent ?? space
  return { name: wearer.name, imageUrl: wearer.imageUrl }
}
