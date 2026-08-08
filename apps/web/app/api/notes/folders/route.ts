// Folder operations within a brain.
//   POST   { communityId, scope, path, content? }   → { ok, indexPath? }  (create folder)
//   PATCH  { communityId, scope, from, to }         → { path }  (rename/move subtree)
//   DELETE ?communityId=&scope=&path=               → { ok }    (soft-delete subtree)
//
// Shared-brain rules (grant model — lib/notes/shared/authz.ts): creating a
// folder needs EDIT at its path (you can shape where you can write); renaming
// or deleting a subtree needs FULL at the source (full = manage the subtree,
// community admins included) plus EDIT at a move's destination. Personal
// brains: always the owner.

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import { principalOf, type ResolvedBrain } from '@/lib/notes/brain'
import { createFolder, createIndexFolder, renameFolder, deleteFolder } from '@/lib/notes/store'
import { indexPathOf } from '@/lib/notes/shared/indexNote'
import { principalCanManage, principalCanWrite } from '@/lib/notes/shared/permissions'
import type { BrainPrincipal } from '@/lib/notes/shared/brainTypes'

function gated(brain: ResolvedBrain): boolean {
  return !brain.isPersonalSpace
}

function manageDenial(p: BrainPrincipal, folderPath: string): string | null {
  return principalCanManage(p, folderPath)
    ? null
    : `Only someone with full access to "${folderPath}" (or a community admin) can reorganize it`
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  const path = typeof body.path === 'string' ? body.path : null
  if (!path) return fail('path is required')
  const p = await principalOf(brain)
  if (gated(brain) && !principalCanWrite(p, path)) {
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
        indexPath: await createIndexFolder(brain, path, content, brain.actor),
      })
    }
    await createFolder(brain, path, brain.actor)
    return NextResponse.json({ ok: true, indexPath: indexPathOf(path) })
  } catch (err) {
    return failFromError(err)
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  const from = typeof body.from === 'string' ? body.from : null
  const to = typeof body.to === 'string' ? body.to : null
  if (!from || !to) return fail('from and to are required')
  const p = await principalOf(brain)
  if (gated(brain)) {
    const denial = manageDenial(p, from)
    if (denial) return fail(denial, 403)
    if (!principalCanWrite(p, to)) {
      return fail(`You need edit access at "${to}" to move a folder there`, 403)
    }
  }
  try {
    return NextResponse.json({ path: await renameFolder(brain, from, to, brain.actor) })
  } catch (err) {
    return failFromError(err)
  }
}

export async function DELETE(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  const path = new URL(req.url).searchParams.get('path')
  if (!path) return fail('path is required')
  const p = await principalOf(brain)
  if (gated(brain)) {
    const denial = manageDenial(p, path)
    if (denial) return fail(denial, 403)
  }
  try {
    await deleteFolder(brain, path)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return failFromError(err)
  }
}
