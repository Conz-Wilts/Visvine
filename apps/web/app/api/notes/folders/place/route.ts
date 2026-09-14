// POST /api/notes/folders/place  { spaceId, path, container }  → { ok }
//
// Place a structural folder — a built-in folder (`agents`, `people`, …), the
// `Sub-spaces` folder, or one room's folder (`subspaces/<id>`) — under a
// folder of the space's own, or back at the top (`container: ''`; for a room,
// the `Sub-spaces` folder). The folder's PATH does not change: the placement
// is recorded as `holds:` on the container's index note and the tree draws
// it there (lib/notes/shared/placedFolders.ts, app/api/notes/tree/route.ts).
//
// Every write here is an ordinary gated note write (`writeGated`): removing
// the folder from whoever held it edits that folder's index note, adding it
// edits the container's — so edit access on each is the whole permission, and
// each lands as a revision like any other edit. A room's own built-in folder
// (`subspaces/<id>/agents`) is placed IN the room: the write hops across under
// the caller's standing there (lib/notes/federation.ts#writeTarget); a room's
// FOLDER is placed in the parent's tree and writes the parent's notes.

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { principalOf, type ResolvedContext } from '@/lib/notes/resolve'
import { visibleVault, writeGated } from '@/lib/notes/contextService'
import { writeTarget } from '@/lib/notes/federation'
import { readNoteOrNull } from '@/lib/notes/store'
import { buildTree } from '@/lib/notes/shared/context'
import { indexPathOf, isIndexPath } from '@/lib/notes/shared/indexNote'
import {
  applyPlacements,
  holdsOf,
  placeableOf,
  placementDenial,
  placementsFrom,
  withHolds,
} from '@/lib/notes/shared/placedFolders'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import { SUBSPACE_FOLDER, parseSubspacePath, rebasePath } from '@/lib/spaces/subspaces'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  const path = typeof body.path === 'string' ? body.path : null
  const container = typeof body.container === 'string' ? body.container : null
  if (!path || container === null) return fail('path and container are required')
  const placed = placeableOf(path)
  if (!placed) return fail(`"${path}" is moved, not placed — only a built-in folder or a sub-space is placed.`)
  const denial = placementDenial(path, container)
  if (denial) return fail(denial, 403)
  const p = await principalOf(context)

  // The space whose index notes record the placement: a room's own folder is
  // placed in the room, everything else in this space.
  let ctx: ResolvedContext = context
  let principal: ContextPrincipal = p
  if (placed.space) {
    const hop = await writeTarget(p, context, rebasePath(placed.space, 'index.md'))
    if ('denial' in hop) return fail(hop.denial, 403)
    ctx = hop.context
    principal = hop.principal
  }
  // Paths as that space sees them. `dest` is the folder as the rules judge it;
  // `record` is the folder whose index note takes the entry — '' records
  // nothing, and a room sent back to the `Sub-spaces` folder is sent home.
  const item = placed.folder
  const dest = placed.space ? (parseSubspacePath(container)?.path ?? '') : container
  const record = dest === SUBSPACE_FOLDER ? '' : dest

  // The rules again, against the tree as it is drawn — the cycle guard needs
  // the drawing, and the client's tree is not trusted for it.
  const { metas } = await visibleVault(principal, ctx)
  const tree = buildTree(metas)
  const placements = placementsFrom(metas)
  applyPlacements(tree, placements)
  const drawn = placementDenial(item, dest, tree)
  if (drawn) return fail(drawn, 403)

  try {
    // Every index note that currently holds it lets go — one holder in the
    // normal run of things, and any strays a hand edit left.
    for (const meta of metas) {
      if (!isIndexPath(meta.path) || meta.path === indexPathOf(record)) continue
      const holds = holdsOf(meta.frontmatter)
      if (!holds.includes(item)) continue
      const content = await readNoteOrNull(ctx, meta.path)
      if (content === null) continue
      const result = await writeGated(principal, ctx, meta.path, withHolds(content, holds.filter((h) => h !== item)))
      if (result.status === 'denied') return fail(result.reason, 403)
    }
    if (record !== '') {
      const indexPath = indexPathOf(record)
      const content = await readNoteOrNull(ctx, indexPath)
      if (content === null) return fail(`"${record}" has no home note to hold it — open the folder once first.`, 404)
      const holds = holdsOf(metas.find((m) => m.path === indexPath)?.frontmatter)
      if (!holds.includes(item)) {
        const result = await writeGated(principal, ctx, indexPath, withHolds(content, [...holds, item]))
        if (result.status === 'denied') return fail(result.reason, 403)
      }
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return failFromError(err)
  }
}
