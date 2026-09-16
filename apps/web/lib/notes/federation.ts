// A public sub-space's context, read through its parent (docs/sub-spaces.md).
//
// The parent's tree, note index, single-note read and search each have a
// federated form here that answers over the parent's own context PLUS every
// public sub-space's, rebased under `subspaces/<id>/`. Nothing is copied: each
// read opens the sub-space's context as of now, so a change there is a change
// here, and a sub-space turned private disappears from the parent on the next
// read.
//
// Access is not weakened to do it. Through the folder a person is who they
// are in the sub-space (`subspaceReader`): a member or admin of it reads —
// and writes, `writeTarget` — under their own standing there, exactly as if
// they had switched to it; everyone else reads under a principal that carries
// only what the sub-space shares with everyone in it — its space-wide grants,
// capped to view — so a restricted folder of the sub-space is as hidden here
// as it is there, and nothing is ever written through the parent's standing.
//
// The other way, the parent shares DOWN — only its connector and agent notes
// flagged `share: subspaces`, read into every sub-space as the read-only
// `parent/` folder (`federateParent`). There is no principal on that side:
// the sub-space's member may hold nothing in the parent, and a parent's
// space-wide grant would leak notes nobody flagged. The flag on the note is
// the whole grant, so the allow-list is computed from content and every read
// under `parent/` is checked against it and nothing else.
//
// Every function takes `(principal, context)` like contextService's, so the
// routes, the actions and an agent's tools call them the same way.

import { LEVEL_VIEW } from './shared/authz'
import { readVisible, searchContext, visibleVault, type BrainSearchResult, type SearchOptions } from './contextService'
import { contextAccessFor, ensureAccessSeeded, spaceWideAccessFor } from './access'
import { SHARED_OWNER_KEY, listRaw, readNoteOrNull, type Context } from './store'
import type { ResolvedContext } from './resolve'
import { buildNoteIndex, buildTree } from './shared/context'
import { parseFrontmatter } from './shared/markdown'
import { connectorNameOfPath, isConnectorNoteAt } from './shared/configKinds'
import type { ContextPrincipal } from './shared/contextTypes'
import type { NoteMeta, TreeNode } from './shared/types'
import type { FusedResult, SearchFilters } from './shared/retrieval'
import { isAdmin, membershipStatus } from '@/lib/auth'
import { flowingSubspace, flowingSubspacesOf, parentOfSubspace } from '@/lib/spaces/subspaceAccess'
import {
  PARENT_FOLDER,
  SUBSPACE_FOLDER,
  graftParent,
  graftSubspace,
  isParentPath,
  isSharedDown,
  isSubspacePath,
  parentWriteDenial,
  parseParentPath,
  parseSubspacePath,
  rebaseMeta,
  rebaseNoteLinks,
  rebaseParentMeta,
  rebaseParentNoteLinks,
  rebaseParentPath,
  rebasePath,
  subspaceWriteDenial,
} from '@/lib/spaces/subspaces'
import type { RawNote } from './shared/types'

export interface SubspaceReader {
  space: { id: string; name: string }
  context: Context
  principal: ContextPrincipal
  /** The person stands in this sub-space — a member or an admin of it — so
   *  `principal` is their own standing there and a write may land. */
  own: boolean
}

/**
 * The principal a parent's member reads one sub-space through. Someone who
 * stands in the sub-space — an active member, or an admin of it (its own, or
 * the parent's where `parentAdmins` is on) — is themselves there: their own
 * grants, their own admin standing, as if they had switched to it. Everyone
 * else reads under the sub-space's space-wide grants capped to view: what it
 * shows all of its members, and no admin standing whatever they hold here.
 * The person is still the person either way, so audited reads carry their
 * name. A system principal (a maintenance pass) reads as everyone.
 */
async function subspaceReader(p: ContextPrincipal, space: { id: string; name: string }): Promise<SubspaceReader> {
  await ensureAccessSeeded(space.id)
  const context: Context = { spaceId: space.id, ownerKey: SHARED_OWNER_KEY }
  const identity = { userId: p.userId, email: p.email, name: p.name, spaceId: space.id }
  if (!p.system && p.userId) {
    const [admin, membership] = await Promise.all([
      isAdmin(p.userId, space.id, p.email),
      membershipStatus(p.userId, space.id),
    ])
    if (admin || membership === 'active') {
      const access = await contextAccessFor(space.id, p.userId)
      return { space, context, principal: { ...identity, spaceAdmin: admin, access }, own: true }
    }
  }
  const access = await spaceWideAccessFor(space.id)
  return {
    space,
    context,
    principal: {
      ...identity,
      spaceAdmin: false,
      access: {
        ...access,
        grants: access.grants.map((g) => ({ ...g, level: Math.min(g.level, LEVEL_VIEW) })),
      },
    },
    own: false,
  }
}

/**
 * Whether anything can flow into this context at all: only a space's shared
 * context takes sub-spaces. (A personal space and a sub-space hold none, so
 * the one query below finds nothing for them.)
 */
function mayFederate(context: Context): boolean {
  return context.ownerKey === SHARED_OWNER_KEY
}

/** Every sub-space read into `context`, each with the principal it is read under. */
async function subspaceReaders(p: ContextPrincipal, context: Context): Promise<SubspaceReader[]> {
  if (!mayFederate(context)) return []
  const subs = await flowingSubspacesOf(context.spaceId)
  return Promise.all(subs.map((s) => subspaceReader(p, s)))
}

/**
 * The reader for the sub-space a parent-side path names, or null when the
 * path is not under `subspaces/<id>` or names a sub-space that does not flow
 * into this space (private, someone else's, or not a space at all —
 * indistinguishable on purpose).
 */
export async function readerForPath(
  p: ContextPrincipal,
  context: Context,
  path: string,
): Promise<{ reader: SubspaceReader; path: string } | null> {
  if (!mayFederate(context)) return null
  const parsed = parseSubspacePath(path)
  if (!parsed) return null
  const sub = await flowingSubspace(context.spaceId, parsed.spaceId)
  if (!sub) return null
  return { reader: await subspaceReader(p, sub), path: parsed.path }
}

// ─── Writing through the wall ────────────────────────────────────────────────

/**
 * Where a write asked for at `path` in `context` lands. For the context's own
 * paths: here, unchanged. For a path under `subspaces/<id>/`: in that
 * sub-space, at the inner path, under the caller's OWN standing there — the
 * same write they could make after switching to it, judged by the same gates
 * (the route still runs `writeDenial` & co. against what comes back). Every
 * path the answer carries is the target's own; `rebase` puts one back on the
 * parent's tree for the response, `rebaseMeta` an index entry.
 *
 * A denial, never a hop: `parent/` (what the parent shares is changed in the
 * parent), the `subspaces` folder and a sub-space's root (there is nothing of
 * the parent's to write there, and a sub-space is renamed or removed from its
 * settings), a sub-space that does not flow here, and one the caller does not
 * stand in — a member of the parent reads it, and joins it to write.
 */
export interface WriteTarget {
  context: ResolvedContext
  principal: ContextPrincipal
  path: string
  /** The sub-space the write lands in; null when it lands here. */
  subspace: { id: string; name: string } | null
  rebase: (path: string) => string
  rebaseMeta: <T extends { path: string; folder: string; linkTargets: string[] }>(meta: T) => T
}

export async function writeTarget(
  p: ContextPrincipal,
  context: ResolvedContext,
  path: string,
): Promise<WriteTarget | { denial: string }> {
  if (isParentPath(path)) return { denial: parentWriteDenial(path)! }
  if (!isSubspacePath(path)) {
    return { context, principal: p, path, subspace: null, rebase: (x) => x, rebaseMeta: (m) => m }
  }
  const parsed = parseSubspacePath(path)
  if (!parsed || !parsed.path) return { denial: subspaceWriteDenial(path)! }
  const hit = await readerForPath(p, context, path)
  if (!hit) return { denial: `"${SUBSPACE_FOLDER}/${parsed.spaceId}" is not a sub-space whose context flows here.` }
  const { reader } = hit
  if (!reader.own) {
    return { denial: `You are not in ${reader.space.name}, so its context is read-only here. Join it to edit.` }
  }
  const id = reader.space.id
  return {
    context: {
      ...reader.context,
      scope: 'shared',
      isAdmin: reader.principal.spaceAdmin,
      isPersonalSpace: false,
      actor: context.actor,
    },
    principal: reader.principal,
    path: hit.path,
    subspace: reader.space,
    rebase: (x) => rebasePath(id, x),
    rebaseMeta: (m) => rebaseMeta(m, id),
  }
}

/**
 * Both ends of a move or rename, resolved the same way — and refused when
 * they land in different spaces: a note moves within the space it is in, so
 * nothing crosses the wall by being dragged over it.
 */
export async function moveTargets(
  p: ContextPrincipal,
  context: ResolvedContext,
  from: string,
  to: string,
): Promise<{ from: WriteTarget; to: WriteTarget } | { denial: string }> {
  const [src, dst] = await Promise.all([writeTarget(p, context, from), writeTarget(p, context, to)])
  if ('denial' in src) return src
  if ('denial' in dst) return dst
  if (src.context.spaceId !== dst.context.spaceId) {
    return { denial: 'A note moves within its own space — a sub-space’s context stays in that sub-space.' }
  }
  return { from: src, to: dst }
}

// ─── Downward ────────────────────────────────────────────────────────────────

export interface ParentShare {
  space: { id: string; name: string }
  context: Context
  /** The parent's own paths it shares — the allow-list, and the only gate. */
  notes: RawNote[]
}

/**
 * What the space `context` sits inside shares with it: the parent's
 * `connectors/` and `agents/` notes flagged `share: subspaces`, read raw —
 * no visibility lens, because the lens asks a question that has no honest
 * answer here ("may this person read a space they may not belong to"), and a
 * shared note is by construction one the parent chose to show every
 * sub-space. Null when `context` is not a sub-space's shared context.
 */
export async function parentShare(context: Context): Promise<ParentShare | null> {
  if (!mayFederate(context)) return null
  const parent = await parentOfSubspace(context.spaceId)
  if (!parent) return null
  const pctx: Context = { spaceId: parent.id, ownerKey: SHARED_OWNER_KEY }
  const raws = await listRaw(pctx)
  const notes = raws.filter((r) => isSharedDown(r.path, parseFrontmatter(r.content), context.spaceId))
  return { space: parent, context: pctx, notes }
}

/**
 * One shared parent note by its PARENT-side path (`connectors/x.md`), or
 * null when the parent shares no such note — absent and unshared are one
 * answer, on purpose.
 */
export async function readSharedFromParent(
  context: Context,
  parentPath: string,
): Promise<{ share: ParentShare; content: string } | null> {
  const share = await parentShare(context)
  if (!share || !share.notes.some((n) => n.path === parentPath)) return null
  const content = await readNoteOrNull(share.context, parentPath)
  return content === null ? null : { share, content }
}

/**
 * One shared parent CONNECTOR by name — the parent's note declaring
 * `type: connector` under that file name, wherever the parent filed it
 * (lib/notes/shared/configKinds.ts) — or null when the parent shares none.
 * The path answered is the parent's own.
 */
export async function readSharedConnectorFromParent(
  context: Context,
  name: string,
): Promise<{ share: ParentShare; content: string; path: string } | null> {
  const share = await parentShare(context)
  if (!share) return null
  const note = share.notes.find((n) => connectorNameOfPath(n.path) === name && isConnectorNoteAt(n.path, n.content))
  return note ? { share, content: note.content, path: note.path } : null
}

/**
 * Graft the parent's shared notes into a sub-space's tree as the `parent/`
 * folder. Nothing is grafted when the parent shares nothing: the folder
 * appears because there is something in it.
 */
async function federateParent(context: Context, root: TreeNode): Promise<void> {
  const share = await parentShare(context)
  if (!share || share.notes.length === 0) return
  graftParent(root, share.space, buildTree(buildNoteIndex(share.notes)))
}

/**
 * Graft every flowing sub-space's tree into `root`. `treeFor` builds one
 * context's own tree — the tree route's, so a sub-space's explicit empty
 * folders and structural folders come across exactly as its own sidebar
 * shows them to a member with the same standing.
 */
export async function federateTree(
  p: ContextPrincipal,
  context: Context,
  root: TreeNode,
  treeFor: (context: Context, principal: ContextPrincipal) => Promise<TreeNode>,
): Promise<void> {
  // Every sub-space is read at once; grafting keeps the readers' order so the
  // tree is the same whichever answers first. A room whose context does not
  // flow here is not drawn at all — a folder that holds nothing and can take
  // nothing is a dead row. The private ones are named on the switcher, where
  // pressing one asks to join.
  const readers = await subspaceReaders(p, context)
  const subRoots = await Promise.all(readers.map((r) => treeFor(r.context, r.principal)))
  readers.forEach((reader, i) => graftSubspace(root, reader.space, subRoots[i], reader.own))
  await federateParent(context, root)
}

/** The context's visible note index plus every flowing sub-space's, rebased. */
export async function federatedMetas(p: ContextPrincipal, context: Context): Promise<NoteMeta[]> {
  const [{ metas }, readers, share] = await Promise.all([
    visibleVault(p, context),
    subspaceReaders(p, context),
    parentShare(context),
  ])
  const out = [...metas]
  const subs = await Promise.all(readers.map((r) => visibleVault(r.principal, r.context)))
  readers.forEach((reader, i) => {
    for (const meta of subs[i].metas) out.push(rebaseMeta(meta, reader.space.id))
  })
  if (share) for (const meta of buildNoteIndex(share.notes)) out.push(rebaseParentMeta(meta))
  return out
}

/**
 * Read one note by path: the context's own note, or — under `subspaces/<id>/` —
 * the sub-space's, through its reader, with links rebased. Null when absent
 * or hidden, indistinguishably.
 */
export async function readFederated(p: ContextPrincipal, context: Context, path: string): Promise<string | null> {
  if (isParentPath(path)) {
    const inner = parseParentPath(path)
    if (!inner) return null
    const hit = await readSharedFromParent(context, inner)
    return hit ? rebaseParentNoteLinks(hit.content, inner) : null
  }
  if (!isSubspacePath(path)) return readVisible(p, context, path)
  const hit = await readerForPath(p, context, path)
  if (!hit || !hit.path) return null
  const content = await readVisible(hit.reader.principal, hit.reader.context, hit.path)
  return content === null ? null : rebaseNoteLinks(content, hit.reader.space.id, hit.path)
}

/**
 * Search the context and every flowing sub-space, fused into one ranking by
 * score. A folder filter naming one of the context's own folders searches
 * only it; `spaces` searches only the sub-spaces. The context's own report
 * (`semantic`, `plan`) is the one returned — every search ran the same plan.
 */
export async function searchFederated(
  p: ContextPrincipal,
  context: Context,
  query: string,
  filters: SearchFilters = {},
  k?: number,
  opts: SearchOptions = {},
): Promise<BrainSearchResult> {
  const subsOnly = filters.folderId === SUBSPACE_FOLDER
  const parentOnly = filters.folderId === PARENT_FOLDER
  const ownOnly = filters.folderId !== undefined && !subsOnly && !parentOnly
  const [own, readers, shared] = await Promise.all([
    searchContext(p, context, query, subsOnly || parentOnly ? { ...filters, folderId: undefined } : filters, k, opts),
    ownOnly || parentOnly ? Promise.resolve([]) : subspaceReaders(p, context),
    ownOnly ? Promise.resolve([]) : searchParentShare(context, query),
  ])
  if (ownOnly) return own
  if (subsOnly || parentOnly) own.hits = []
  if (parentOnly) return { ...own, hits: k ? shared.slice(0, k) : shared }
  if (readers.length === 0 && shared.length === 0) return own
  const hits = [...own.hits, ...shared]
  const subs = await Promise.all(
    readers.map((reader) =>
      searchContext(
        reader.principal,
        reader.context,
        query,
        { ...filters, folderId: undefined },
        k,
        // The rewrite is one LLM call per search; the parent's plan already
        // paid for it, and a sub-space's search reuses the same words.
        { ...opts, rewrite: false },
      ),
    ),
  )
  readers.forEach((reader, i) => {
    for (const h of subs[i].hits) hits.push({ ...h, path: rebasePath(reader.space.id, h.path) })
  })
  hits.sort((a, b) => b.score - a.score)
  return { ...own, hits: k ? hits.slice(0, k) : hits }
}

/**
 * Keyword hits over what the parent shares — a handful of connector and agent
 * notes, not worth the retrieval stack: matched on the note's own words,
 * scored by how many of the query's terms it holds, in the fused shape.
 * Nothing outside the allow-list is ever consulted.
 */
async function searchParentShare(context: Context, query: string): Promise<FusedResult[]> {
  const share = await parentShare(context)
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const hits: FusedResult[] = []
  if (!share || terms.length === 0) return hits
  for (const meta of buildNoteIndex(share.notes)) {
    const raw = share.notes.find((n) => n.path === meta.path)
    const hay = `${meta.title}
${raw?.content ?? ''}`.toLowerCase()
    const score = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0) / terms.length
    if (score > 0) hits.push({ path: rebaseParentPath(meta.path), title: meta.title, score, kind: 'note' })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits
}
