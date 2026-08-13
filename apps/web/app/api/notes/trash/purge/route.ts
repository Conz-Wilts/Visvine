// POST /api/notes/trash/purge  { spaceId, scope, id } → { ok }
// Force-delete one trashed note before its 7-day retention runs out. Same
// irreversibility as emptying the trash, so the shared context restricts it to
// admins (personal context: always the owner).

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { purgeTrashEntry } from '@/lib/notes/store'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  if (context.scope === 'shared' && !context.isAdmin) {
    return fail('Only an admin can permanently delete from the space context trash', 403)
  }
  const id = typeof body.id === 'string' ? body.id : null
  if (!id) return fail('id is required')
  try {
    await purgeTrashEntry(context, id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return failFromError(err)
  }
}
