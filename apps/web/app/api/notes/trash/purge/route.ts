// POST /api/notes/trash/purge  { communityId, scope, id } → { ok }
// Force-delete one trashed note before its 7-day retention runs out. Same
// irreversibility as emptying the trash, so the shared brain restricts it to
// admins (personal brain: always the owner).

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import { purgeTrashEntry } from '@/lib/notes/store'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  if (brain.scope === 'shared' && !brain.isAdmin) {
    return fail('Only an admin can permanently delete from the community brain trash', 403)
  }
  const id = typeof body.id === 'string' ? body.id : null
  if (!id) return fail('id is required')
  try {
    await purgeTrashEntry(brain, id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return failFromError(err)
  }
}
