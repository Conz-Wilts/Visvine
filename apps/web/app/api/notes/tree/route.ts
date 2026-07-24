// GET /api/notes/tree?communityId=&scope=
// The folder/note tree for the sidebar (note-derived folders + explicit empty
// folders, sorted folders-first then alphabetically). Shared-brain trees are
// built over the visibility-filtered vault, and explicitly-created empty
// folders are grafted only when the caller may see them (a grant reaches the
// folder or starts inside it — restricted subtrees stay fully hidden).

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/brain'
import { visibleVault } from '@/lib/notes/brainService'
import { listFolders } from '@/lib/notes/store'
import { buildTree } from '@/lib/notes/shared/graph'
import { principalSeesFolder } from '@/lib/notes/shared/permissions'
import type { TreeNode } from '@/lib/notes/shared/types'

// Graft an explicitly-created empty folder onto the note-derived tree (mirrors
// store.tree, which we bypass so the visibility lens applies to the notes).
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

// Folders first, then notes, each alphabetically (mirrors store.tree).
function sortChildren(node: TreeNode): void {
  if (!node.children) return
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return (a.title ?? a.name).localeCompare(b.title ?? b.name)
  })
  for (const child of node.children) sortChildren(child)
}

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  const p = await principalOf(brain)
  const [{ metas }, folders] = await Promise.all([visibleVault(p, brain), listFolders(brain)])
  const root = buildTree(metas)
  for (const folder of folders) {
    // Graft only folders the caller may see: readable themselves, or holding a
    // readable grant somewhere inside (restricted subtrees stay invisible).
    if (brain.scope === 'shared' && !brain.isPersonalSpace && !principalSeesFolder(p, folder)) continue
    ensureFolderPath(root, folder)
  }
  sortChildren(root)
  return NextResponse.json({ tree: root })
}
