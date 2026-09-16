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
//
// A folder under subspaces/<id>/ is the sub-space's: the operation hops to
// that space under the caller's own standing there (lib/notes/federation.ts#
// writeTarget), and the rules above are judged against it. `parent/`, the
// `subspaces` folder and a sub-space's root are refused there.

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { principalOf, type ResolvedContext } from '@/lib/notes/resolve'
import { createFolder, createIndexFolder, renameFolder, deleteFolder } from '@/lib/notes/store'
import { indexPathOf } from '@/lib/notes/shared/indexNote'
import { principalCanWrite } from '@/lib/notes/shared/permissions'
import { namespaceFeatureDenial, folderConfigKindDenial } from '@/lib/notes/contextService'
import { moveTargets, writeTarget } from '@/lib/notes/federation'
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
  const p = await principalOf(context)
  const target = await writeTarget(p, context, path)
  if ('denial' in target) return fail(target.denial, 403)
  const { context: ctx, principal, path: at } = target
  if (gated(ctx) && !principalCanWrite(principal, at)) {
    return fail(`You need edit access at "${at}" to create a folder there`, 403)
  }
  // A namespace belongs to a tool, and a tool that is off does not get one —
  // this is the one path that could conjure the bare folder with no note in it
  // (lib/notes/shared/namespaces.ts).
  const namespace = await namespaceFeatureDenial(ctx, at)
  if (namespace) return fail(namespace, 403)
  try {
    // A folder IS its index note. With `content` the caller wrote that note (the
    // "Index" create tile) and it becomes the folder's home page; without it the
    // folder gets the auto-generated stub, as an empty folder always has.
    const content = typeof body.content === 'string' && body.content.length > 0 ? body.content : null
    if (content) {
      return NextResponse.json({
        ok: true,
        indexPath: target.rebase(await createIndexFolder(ctx, at, content, ctx.actor)),
      })
    }
    await createFolder(ctx, at, ctx.actor)
    return NextResponse.json({ ok: true, indexPath: target.rebase(indexPathOf(at)) })
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
  const ends = await moveTargets(p, context, from, to)
  if ('denial' in ends) return fail(ends.denial, 403)
  const { context: ctx, principal, path: src } = ends.from
  const dst = ends.to.path
  if (gated(ctx)) {
    const denial = reorganizeDenial(principal, src) ?? (await folderConfigKindDenial(principal, ctx, src))
    if (denial) return fail(denial, 403)
    if (!principalCanWrite(principal, dst)) {
      return fail(`You need edit access at "${dst}" to move a folder there`, 403)
    }
  }
  try {
    return NextResponse.json({ path: ends.to.rebase(await renameFolder(ctx, src, dst, ctx.actor)) })
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
  const target = await writeTarget(p, context, path)
  if ('denial' in target) return fail(target.denial, 403)
  const { context: ctx, principal, path: at } = target
  if (gated(ctx)) {
    const denial = reorganizeDenial(principal, at) ?? (await folderConfigKindDenial(principal, ctx, at))
    if (denial) return fail(denial, 403)
  }
  try {
    await deleteFolder(ctx, at)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return failFromError(err)
  }
}
