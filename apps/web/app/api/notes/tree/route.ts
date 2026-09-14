// GET /api/notes/tree?spaceId=&scope=
// The folder/note tree for the sidebar (note-derived folders + explicit empty
// folders, sorted folders-first then alphabetically). Shared-context trees are
// built over the visibility-filtered vault, and explicitly-created empty
// folders are grafted only when the caller may see them (a grant reaches the
// folder or starts inside it — restricted subtrees stay fully hidden).
//
// A public sub-space's own tree is grafted in under `subspaces/<id>/`
// (lib/notes/federation.ts), read under the sub-space's everyone-principal.

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
import { buildTree, sortTree } from '@/lib/notes/shared/context'
import { principalSeesFolder } from '@/lib/notes/shared/permissions'
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
  const [{ metas }, folders, featureConfig] = await Promise.all([
    visibleVault(p, context),
    listFolders(context),
    // Request-memoized: the resolver already loaded this space's row.
    getFeatureConfig(context.spaceId),
  ])
  const root = buildTree(metas)
  // The namespaces a person writes into FROM here, standing empty so they can
  // be written into: `agents/` for anyone, `connectors/` for the admin who may
  // write it (lib/notes/shared/namespaces.ts). They aren't rows in
  // contextFolder — nothing created them — so they're grafted here alongside
  // the real empty folders, and the graft is what makes them un-missable:
  // deleting one is refused (namespaceFolderDenial).
  //
  // Everything else appears with its first note. `p.spaceAdmin`, not the
  // caller's standing in the space they asked about: this function is re-entered
  // for each public sub-space under its own everyone-principal (federateTree
  // below), and a parent's admin administers nothing there.
  for (const dir of standingFolders(featureConfig, { isAdmin: p.spaceAdmin })) {
    ensureFolderPath(root, dir)
  }
  for (const folder of folders) {
    // Graft only folders the caller may see: readable themselves, or holding a
    // readable grant somewhere inside (restricted subtrees stay invisible).
    if (gated && !principalSeesFolder(p, folder)) continue
    ensureFolderPath(root, folder)
  }
  return root
}

export async function GET(req: NextRequest) {
  const session = await requireSession()
  if (session instanceof Response) return session
  const url = new URL(req.url)
  const context = await resolveContext(session, url.searchParams.get('spaceId'), url.searchParams.get('scope'))
  if (context instanceof Response) return context

  const p = await principalOf(context)
  const gated = context.scope === 'shared' && !context.isPersonalSpace
  const root = await treeFor(context, p, gated)
  await federateTree(p, context, root, (ctx, principal) => treeFor(ctx, principal, true))
  sortTree(root)
  return NextResponse.json({ tree: root })
}
