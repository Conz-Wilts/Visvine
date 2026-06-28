// POST /api/notes/trash/empty  { communityId, scope } → { ok }
// Permanently purge the brain's trash. Irreversible, so the shared brain restricts
// it to admins (personal brain: always the owner).

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import { emptyTrash } from '@/lib/notes/store'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  if (brain.scope === 'shared' && !brain.isAdmin) {
    return fail('Only an admin can empty the community brain trash', 403)
  }
  try {
    await emptyTrash(brain)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return failFromError(err)
  }
}
