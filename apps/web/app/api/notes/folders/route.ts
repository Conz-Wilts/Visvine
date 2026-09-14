// Folder operations within a context.
//   POST   { spaceId, scope, path, content? }   → { ok, indexPath? }  (create folder)
//   PATCH  { spaceId, scope, from, to }         → { path }  (rename/move subtree)
//   DELETE ?spaceId=&scope=&path=               → { ok }    (soft-delete subtree)
//
// Shared-context rules (grant model — lib/notes/shared/authz.ts): creating a
// folder needs EDIT at its path (you can shape where you can write); renaming
// or deleting a subtree needs FULL at the source (full = manage the subtree,
// space admins included) plus EDIT at a move's destination. Personal
// contexts: always the owner.

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { principalOf, type ResolvedContext } from '@/lib/notes/resolve'
import { createFolder, createIndexFolder, renameFolder, deleteFolder } from '@/lib/notes/store'
import { indexPathOf } from '@/lib/notes/shared/indexNote'
import { principalCanWrite } from '@/lib/notes/shared/permissions'
import { subspaceWriteDenial } from '@/lib/spaces/subspaces'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'

function gated(context: ResolvedContext): boolean {
  return !context.isPersonalSpace
}

/**
 * Reorganizing a folder needs EDIT on it — moving and deleting is what Editor
 * says it can do, and an editor could empty the folder note by note anyway, so
 * gating the folder itself higher bought nothing. (It used to require the
 * retired 'full' level.)
 */
function reorganizeDenial(p: ContextPrincipal, folderPath: string): string | null {
  return principalCanWrite(p, folderPath)
    ? null
    : `You need edit access to "${folderPath}" to reorganize it`
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  const path = typeof body.path === 'string' ? body.path : null
  if (!path) return fail('path is required')
  // subspaces/ is read-only: it is where sub-spaces' context appears
  // (lib/spaces/subspaces.ts), never a folder of this space's own.
  const reserved = subspaceWriteDenial(path)
  if (reserved) return fail(reserved, 403)
  const p = await principalOf(context)
  if (gated(context) && !principalCanWrite(p, path)) {
    return fail(`You need edit access at "${path}" to create a folder there`, 403)
  }
  try {
    // A folder IS its index note. With `content` the caller wrote that note (the
    // "Index" create tile) and it becomes the folder's home page; without it the
    // folder gets the auto-generated stub, as an empty folder always has.
    const content = typeof body.content === 'string' && body.content.length > 0 ? body.content : null
    if (content) {
      return NextResponse.json({
        ok: true,
        indexPath: await createIndexFolder(context, path, content, context.actor),
      })
    }
    await createFolder(context, path, context.actor)
    return NextResponse.json({ ok: true, indexPath: indexPathOf(path) })
  } catch (err) {
    return failFromError(err)
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  const from = typeof body.from === 'string' ? body.from : null
  const to = typeof body.to === 'string' ? body.to : null
  if (!from || !to) return fail('from and to are required')
  const p = await principalOf(context)
  if (gated(context)) {
    const denial = reorganizeDenial(p,from)
    if (denial) return fail(denial, 403)
    if (!principalCanWrite(p, to)) {
      return fail(`You need edit access at "${to}" to move a folder there`, 403)
    }
  }
  try {
    return NextResponse.json({ path: await renameFolder(context, from, to, context.actor) })
  } catch (err) {
    return failFromError(err)
  }
}

export async function DELETE(req: NextRequest) {
  const context = await requireContext(req)
  if (context instanceof Response) return context
  const path = new URL(req.url).searchParams.get('path')
  if (!path) return fail('path is required')
  const p = await principalOf(context)
  if (gated(context)) {
    const denial = reorganizeDenial(p,path)
    if (denial) return fail(denial, 403)
  }
  try {
    await deleteFolder(context, path)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return failFromError(err)
  }
}
