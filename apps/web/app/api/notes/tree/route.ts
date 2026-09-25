// GET /api/notes/tree?spaceId=&scope=
// The folder/note tree for the sidebar (note-derived folders + explicit empty
// folders, sorted folders-first then alphabetically). Shared-context trees are
// built over the visibility-filtered vault, and explicitly-created empty
// folders are grafted only when the caller may see them (a grant reaches the
// folder or starts inside it — restricted subtrees stay fully hidden).
//
// A flowing sub-space's own tree is grafted in under `subspaces/<id>/`, inside
// one `Sub-spaces` folder (lib/notes/federation.ts), read under the principal
// the caller reads it through. Built-in folders and the rooms are then DRAWN
// where the space's index notes place them (lib/notes/shared/placedFolders.ts) —
// the paths do not change, only the shape the sidebar shows.

import { NextRequest, NextResponse } from 'next/server'
import { getFeatureConfig } from '@/lib/auth'
import { requireSession } from '@/lib/session'
import { principalOf, resolveContext } from '@/lib/notes/resolve'
import { federateTree } from '@/lib/notes/federation'
import type { Context } from '@/lib/notes/store'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import { visibleVault } from '@/lib/notes/contextService'
import { listFolders } from '@/lib/notes/store'
import { standingFolders } from '@/lib/notes/entities'
import { hiddenLandingsOf, landingHomesFrom } from '@/lib/notes/shared/namespaces'
import { isIndexPath } from '@/lib/notes/shared/indexNote'
import { buildTree, sortTree } from '@/lib/notes/shared/context'
import { principalSeesFolder } from '@/lib/notes/shared/permissions'
import { applyPlacements, placementsFrom } from '@/lib/notes/shared/placedFolders'
import { pruneEmptySubspacesFolder } from '@/lib/spaces/subspaces'
import type { TreeNode } from '@/lib/notes/shared/types'

// Graft an explicitly-created empty folder onto the note-derived tree. A folder
// only lands here when it produced no visible note — so it has no visible index
// note either, and no display title to take: it shows its path segment. (A title
// read from a note the caller can't see would leak past the visibility lens.)
function ensureFolderPath(root: TreeNode, folderPath: string): void {
  const segments = folderPath.split('/').filter(Boolean)
  let cur = root
  let acc = ''
  for (const seg of segments) {
    acc = acc ? `${acc}/${seg}` : seg
    cur.children ??= []
    let child = cur.children.find((c) => c.kind === 'folder' && c.path === acc)
    if (!child) {
      child = { name: seg, path: acc, kind: 'folder', children: [] }
      cur.children.push(child)
    }
    cur = child
  }
}

/** One context's own tree: its visible notes, its empty folders, its tools' folders.
 *  `gated` = the folder-visibility lens applies (a shared context that is not
 *  a personal space). */
async function treeFor(context: Context, p: ContextPrincipal, gated: boolean): Promise<TreeNode> {
  const { root, placements } = await ownTree(context, p, gated)
  // Where this context's own index notes put its built-in folders — applied
  // here, before a sub-space's tree is rebased into its parent's, so a room's
  // layout travels with it (lib/notes/shared/placedFolders.ts).
  applyPlacements(root, placements)
  return root
}

async function ownTree(
  context: Context,
  p: ContextPrincipal,
  gated: boolean,
): Promise<{ root: TreeNode; placements: Map<string, string> }> {
  const [{ metas }, folders, featureConfig] = await Promise.all([
    visibleVault(p, context),
    listFolders(context),
    // Request-memoized: the resolver already loaded this space's row.
    getFeatureConfig(context.spaceId),
  ])
  const root = buildTree(metas)
  // The folders every tool this space runs brings with it, empty or not — the
  // directory's `people/`, `spaces/`, `events/`, `resources/`, `agents/`,
  // `tools/` for everyone and `connectors/`, `models/` for an admin, plus
  // Channels' `channels/` and `sections/` where that tool is on
  // (lib/notes/shared/namespaces.ts). THIS IS WHY A NEW SPACE HAS FOLDERS:
  // provisionSpace writes no folder rows, so the shape of a space's context is
  // decided here, at read time, from the table — which is also how a space
  // created a year ago has exactly the same shape as one created just now. A
  // fixed folder cannot be deleted (namespaceFolderDenial); a landing folder
  // can while it is empty, and may have moved (lib/notes/landing.ts).
  //
  // `p.spaceAdmin`, not the caller's standing in the space they asked about:
  // this function is re-entered for each flowing sub-space under the
  // principal the caller reads it through (federateTree below) — their own
  // standing when they are in it, the everyone-principal otherwise — and a
  // parent's admin administers nothing there unless the sub-space says so.
  // A landing folder the space moved stands where it went, and one it deleted
  // stands only while something is in it (lib/notes/landing.ts) — both read
  // off the index notes already in hand.
  const indexes = metas.filter((m) => isIndexPath(m.path))
  const homes = landingHomesFrom(indexes)
  const hidden = hiddenLandingsOf(metas.find((m) => m.path === 'index.md')?.frontmatter)
  for (const dir of standingFolders(featureConfig, { isAdmin: p.spaceAdmin, homes, hidden })) {
    ensureFolderPath(root, dir)
  }
  for (const folder of folders) {
    // Graft only folders the caller may see: readable themselves, or holding a
    // readable grant somewhere inside (restricted subtrees stay invisible).
    if (gated && !principalSeesFolder(p, folder)) continue
    ensureFolderPath(root, folder)
  }
  return { root, placements: placementsFrom(metas) }
}

export async function GET(req: NextRequest) {
  const session = await requireSession()
  if (session instanceof Response) return session
  const url = new URL(req.url)
  const context = await resolveContext(session, url.searchParams.get('spaceId'), url.searchParams.get('scope'))
  if (context instanceof Response) return context

  const p = await principalOf(context)
  const gated = context.scope === 'shared' && !context.isPersonalSpace
  const { root, placements } = await ownTree(context, p, gated)
  applyPlacements(root, placements)
  await federateTree(p, context, root, (ctx, principal) => treeFor(ctx, principal, true))
  // Once more, now that the sub-spaces are grafted: the entries naming a room
  // (`subspaces/<id>`) or the `Sub-spaces` folder had nothing to move before.
  // Idempotent for the rest. Then the `Sub-spaces` folder goes if it is empty.
  applyPlacements(root, placements)
  pruneEmptySubspacesFolder(root)
  sortTree(root)
  return NextResponse.json({ tree: root })
}
