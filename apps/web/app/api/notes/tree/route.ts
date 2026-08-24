// GET /api/notes/tree?spaceId=&scope=
// The folder/note tree for the sidebar (note-derived folders + explicit empty
// folders, sorted folders-first then alphabetically). Shared-context trees are
// built over the visibility-filtered vault, and explicitly-created empty
// folders are grafted only when the caller may see them (a grant reaches the
// folder or starts inside it — restricted subtrees stay fully hidden).
//
// A sub-space's record folder additionally carries that space's OWN tree,
// federated in — see federate() below.

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireSession } from '@/lib/session'
import { principalOf, resolveContext, type ResolvedContext } from '@/lib/notes/resolve'
import { visibleVault } from '@/lib/notes/contextService'
import { listFolders } from '@/lib/notes/store'
import { structuralFolders } from '@/lib/notes/entities'
import type { SpaceFeatureConfig } from '@/lib/types'
import { buildTree, sortTree } from '@/lib/notes/shared/context'
import { graftForeign, spaceFolders } from '@/lib/notes/shared/federation'
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

/** One context's own tree: its visible notes, its empty folders, its tools' folders. */
async function treeFor(context: ResolvedContext): Promise<TreeNode> {
  const p = await principalOf(context)
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
    if (context.scope === 'shared' && !context.isPersonalSpace && !principalSeesFolder(p, folder)) continue
    ensureFolderPath(root, folder)
  }
  return root
}

/**
 * The child's own tree, under its record folder: expand "Building Blackbird" in
 * the parent and you see what that space actually holds. What comes across, and
 * how its paths are rebased, is lib/notes/shared/federation.ts.
 *
 * Access is not weakened to do it. Every child is resolved through the ordinary
 * `resolveContext` for THIS session (a viewer who is not in the child space gets
 * its 403 and the folder stays empty) and its tree is built through the same
 * visibility lens as any other, so a restricted subtree of the child is as
 * hidden here as it is there.
 *
 * `seen` and the depth cap are belt and braces against a cycle in the data — a
 * record folder pointing at an ancestor — which the hierarchy rules forbid but
 * this walk must survive regardless.
 */
async function federate(
  root: TreeNode,
  session: Awaited<ReturnType<typeof requireSession>>,
  seen: Set<string>,
  depth = 0,
): Promise<void> {
  if (session instanceof Response || depth >= 3) return
  for (const folder of spaceFolders(root)) {
    const childId = folder.space!
    if (seen.has(childId)) continue
    seen.add(childId)
    const context = await resolveContext(session, childId)
    if (context instanceof Response) continue
    const childRoot = await treeFor(context)
    await federate(childRoot, session, seen, depth + 1)
    graftForeign(folder, childRoot, childId)
  }
}

export async function GET(req: NextRequest) {
  const session = await requireSession()
  if (session instanceof Response) return session
  const url = new URL(req.url)
  const context = await resolveContext(session, url.searchParams.get('spaceId'), url.searchParams.get('scope'))
  if (context instanceof Response) return context

  const root = await treeFor(context)
  await federate(root, session, new Set([context.spaceId]))
  sortTree(root)
  return NextResponse.json({ tree: root })
}
