// Folder operations within a brain.
//   POST   { communityId, scope, path }            → { ok }    (create empty folder)
//   PATCH  { communityId, scope, from, to }         → { path }  (rename/move subtree)
//   DELETE ?communityId=&scope=&path=               → { ok }    (soft-delete subtree)
//
// In the shared brain a REGISTERED top-level folder is managed by its folder
// admins (community admins included); unregistered folders keep the legacy
// behavior — any member may create, only community admins may rename/delete.
// Personal brains: always the owner.

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import { principalOf, type ResolvedBrain } from '@/lib/notes/brain'
import { createFolder, renameFolder, deleteFolder } from '@/lib/notes/store'
import { folderIdOfPath } from '@/lib/notes/shared/placement'
import { folderById, principalIsFolderAdmin } from '@/lib/notes/shared/permissions'
import type { BrainPrincipal } from '@/lib/notes/shared/brainTypes'

function canRestructure(scope: 'shared' | 'personal', isAdmin: boolean): boolean {
  return scope === 'personal' || isAdmin
}

// The registered-folder gate: when a folder path's TOP-LEVEL segment is a
// registered folder, only its folder admins may manage it. Returns the denial
// reason, or null when unregistered (legacy checks apply) or allowed.
function registeredFolderDenial(
  brain: ResolvedBrain,
  p: BrainPrincipal,
  folderPath: string,
): string | null {
  if (brain.scope !== 'shared') return null
  // folderIdOfPath is for NOTE paths ("deals" alone would read as root-level);
  // a trailing slash makes the folder path's first segment the governing id.
  const topLevel = folderIdOfPath(`${folderPath}/`)
  const folder = folderById(p.folders, topLevel)
  if (folder && !principalIsFolderAdmin(p, topLevel)) {
    return `Only an admin of "${folder.name}" can manage this folder`
  }
  return null
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  const path = typeof body.path === 'string' ? body.path : null
  if (!path) return fail('path is required')
  const p = await principalOf(brain)
  const denial = registeredFolderDenial(brain, p, path)
  if (denial) return fail(denial, 403)
  try {
    await createFolder(brain, path)
    return NextResponse.json({ ok: true })
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
  // Registered folders are folder-admin territory on BOTH ends of a move;
  // unregistered ones fall back to the legacy community-admin rule.
  const denial = registeredFolderDenial(brain, p, from) ?? registeredFolderDenial(brain, p, to)
  if (denial) return fail(denial, 403)
  const registered =
    brain.scope === 'shared' && folderById(p.folders, folderIdOfPath(`${from}/`)) !== undefined
  if (!registered && !canRestructure(brain.scope, brain.isAdmin)) {
    return fail('Only an admin can reorganize the community brain', 403)
  }
  try {
    return NextResponse.json({ path: await renameFolder(brain, from, to) })
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
  const denial = registeredFolderDenial(brain, p, path)
  if (denial) return fail(denial, 403)
  const registered =
    brain.scope === 'shared' && folderById(p.folders, folderIdOfPath(`${path}/`)) !== undefined
  if (!registered && !canRestructure(brain.scope, brain.isAdmin)) {
    return fail('Only an admin can reorganize the community brain', 403)
  }
  try {
    await deleteFolder(brain, path)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return failFromError(err)
  }
}
