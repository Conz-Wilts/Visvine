// A public sub-space's context, read through its parent (docs/sub-spaces.md).
//
// The parent's tree, note index, single-note read and search each have a
// federated form here that answers over the parent's own context PLUS every
// public sub-space's, rebased under `spaces/<id>/`. Nothing is copied: each
// read opens the sub-space's context as of now, so a change there is a change
// here, and a sub-space turned private disappears from the parent on the next
// read.
//
// Access is not weakened to do it. A sub-space is read under a principal of
// its own (`subspaceReader`) that carries only what the sub-space shares with
// everyone in it — its space-wide grants, capped to view — so a restricted
// folder of the sub-space is as hidden here as it is there, and nothing read
// through the parent can ever be written through it.
//
// Every function takes `(principal, context)` like contextService's, so the
// routes, the actions and an agent's tools call them the same way.

import { LEVEL_VIEW } from './shared/authz'
import { readVisible, searchContext, visibleVault, type BrainSearchResult, type SearchOptions } from './contextService'
import { ensureAccessSeeded, spaceWideAccessFor } from './access'
import { SHARED_OWNER_KEY, type Context } from './store'
import type { ContextPrincipal } from './shared/contextTypes'
import type { NoteMeta, TreeNode } from './shared/types'
import type { SearchFilters } from './shared/retrieval'
import { flowingSubspace, flowingSubspacesOf, lockedSubspacesOf } from '@/lib/spaces/subspaceAccess'
import {
  SUBSPACE_FOLDER,
  graftLockedSubspace,
  graftSubspace,
  isSubspacePath,
  parseSubspacePath,
  rebaseMeta,
  rebaseNoteLinks,
  rebasePath,
} from '@/lib/spaces/subspaces'

export interface SubspaceReader {
  space: { id: string; name: string }
  context: Context
  principal: ContextPrincipal
}

/**
 * The principal a parent's member reads one sub-space through. Not an admin
 * there whatever they are here; grants are the sub-space's space-wide ones at
 * view; the person is still the person, so audited reads carry their name.
 */
async function subspaceReader(p: ContextPrincipal, space: { id: string; name: string }): Promise<SubspaceReader> {
  await ensureAccessSeeded(space.id)
  const access = await spaceWideAccessFor(space.id)
  return {
    space,
    context: { spaceId: space.id, ownerKey: SHARED_OWNER_KEY },
    principal: {
      userId: p.userId,
      email: p.email,
      name: p.name,
      spaceId: space.id,
      spaceAdmin: false,
      access: {
        ...access,
        grants: access.grants.map((g) => ({ ...g, level: Math.min(g.level, LEVEL_VIEW) })),
      },
    },
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
 * path is not under `spaces/<id>` or names a sub-space that does not flow
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
  for (const reader of await subspaceReaders(p, context)) {
    const subRoot = await treeFor(reader.context, reader.principal)
    graftSubspace(root, reader.space, subRoot)
  }
  // The private ones are named after them, and nothing of theirs is read to do
  // it — a locked folder is the name and the lock. Only for a signed-in caller
  // standing in this space, which is the only person the row would mean
  // anything to.
  if (mayFederate(context) && p.userId) {
    for (const sub of await lockedSubspacesOf(context.spaceId, p.userId)) {
      graftLockedSubspace(root, sub)
    }
  }
}

/** The context's visible note index plus every flowing sub-space's, rebased. */
export async function federatedMetas(p: ContextPrincipal, context: Context): Promise<NoteMeta[]> {
  const { metas } = await visibleVault(p, context)
  const out = [...metas]
  for (const reader of await subspaceReaders(p, context)) {
    const sub = await visibleVault(reader.principal, reader.context)
    for (const meta of sub.metas) out.push(rebaseMeta(meta, reader.space.id))
  }
  return out
}

/**
 * Read one note by path: the context's own note, or — under `spaces/<id>/` —
 * the sub-space's, through its reader, with links rebased. Null when absent
 * or hidden, indistinguishably.
 */
export async function readFederated(p: ContextPrincipal, context: Context, path: string): Promise<string | null> {
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
  const ownOnly = filters.folderId !== undefined && !subsOnly
  const own = await searchContext(p, context, query, subsOnly ? { ...filters, folderId: undefined } : filters, k, opts)
  if (ownOnly) return own
  if (subsOnly) own.hits = []
  const readers = await subspaceReaders(p, context)
  if (readers.length === 0) return own
  const hits = [...own.hits]
  for (const reader of readers) {
    const sub = await searchContext(
      reader.principal,
      reader.context,
      query,
      { ...filters, folderId: undefined },
      k,
      // The rewrite is one LLM call per search; the parent's plan already
      // paid for it, and a sub-space's search reuses the same words.
      { ...opts, rewrite: false },
    )
    for (const h of sub.hits) hits.push({ ...h, path: rebasePath(reader.space.id, h.path) })
  }
  hits.sort((a, b) => b.score - a.score)
  return { ...own, hits: k ? hits.slice(0, k) : hits }
}
