// Folder operations within a brain.
//   POST   { communityId, scope, path }            → { ok }    (create empty folder)
//   PATCH  { communityId, scope, from, to }         → { path }  (rename/move subtree)
//   DELETE ?communityId=&scope=&path=               → { ok }    (soft-delete subtree)
//
// Any member may create a folder; rename/delete restructure shared content, so
// in the shared brain they're admin-only (personal brain: always the owner).

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import { createFolder, renameFolder, deleteFolder } from '@/lib/notes/store'

function canRestructure(scope: 'shared' | 'personal', isAdmin: boolean): boolean {
  return scope === 'personal' || isAdmin
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  const path = typeof body.path === 'string' ? body.path : null
  if (!path) return fail('path is required')
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
  if (!canRestructure(brain.scope, brain.isAdmin)) {
    return fail('Only an admin can reorganize the community brain', 403)
  }
  const from = typeof body.from === 'string' ? body.from : null
  const to = typeof body.to === 'string' ? body.to : null
  if (!from || !to) return fail('from and to are required')
  try {
    return NextResponse.json({ path: await renameFolder(brain, from, to) })
  } catch (err) {
    return failFromError(err)
  }
}

export async function DELETE(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  if (!canRestructure(brain.scope, brain.isAdmin)) {
    return fail('Only an admin can reorganize the community brain', 403)
  }
  const path = new URL(req.url).searchParams.get('path')
  if (!path) return fail('path is required')
  try {
    await deleteFolder(brain, path)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return failFromError(err)
  }
}
