// POST /api/notes/trash/empty  { spaceId, scope } → { ok }
// Permanently purge the context's trash. Irreversible, so the shared context restricts
// it to admins (personal context: always the owner).

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { emptyTrash } from '@/lib/notes/store'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  if (context.scope === 'shared' && !context.isAdmin) {
    return fail('Only an admin can empty the space context trash', 403)
  }
  try {
    await emptyTrash(context)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return failFromError(err)
  }
}
