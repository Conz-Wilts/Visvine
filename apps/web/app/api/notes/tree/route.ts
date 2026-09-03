// GET /api/notes/tree?spaceId=&scope=
// The folder/note tree for the sidebar (note-derived folders + explicit empty
// folders, sorted folders-first then alphabetically). Shared-context trees are
// built over the visibility-filtered vault, and explicitly-created empty
// folders are grafted only when the caller may see them (a grant reaches the
// folder or starts inside it — restricted subtrees stay fully hidden).
//
// A public sub-space's own tree is grafted in under `spaces/<id>/`
// (lib/notes/federation.ts), read under the sub-space's everyone-principal.

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireSession } from '@/lib/session'
import { principalOf, resolveContext } from '@/lib/notes/resolve'
import { federateTree } from '@/lib/notes/federation'
import type { Context } from '@/lib/notes/store'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import { visibleVault } from '@/lib/notes/contextService'
import { listFolders } from '@/lib/notes/store'
import { structuralFolders } from '@/lib/notes/entities'
import type { SpaceFeatureConfig } from '@/lib/types'
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
  const [{ metas }, folders, space] = await Promise.all([
    visibleVault(p, context),
    listFolders(context),
    prisma.space.findUnique({ where: { id: context.spaceId }, select: { featureConfig: true } }),
  ])
  const root = buildTree(metas)
  // The folders a space has by virtue of the tools it runs — Agents on means
  // `agents/` is in the tree from the start, empty, rather than appearing the
  // first time somebody writes one. They aren't rows in contextFolder (nothing
  // created them), so they're grafted here alongside the real empty folders,
  // and the same graft is what makes them un-missable: deleting one is refused
  // (namespaceFolderDenial), and a space that turns the tool off simply stops
  // being handed the folder.
  for (const dir of structuralFolders((space?.featureConfig ?? null) as SpaceFeatureConfig | null)) {
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
