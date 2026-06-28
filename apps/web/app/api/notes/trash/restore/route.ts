// POST /api/notes/trash/restore  { communityId, scope, id } → { path }
// Restore a soft-deleted note to its original path (suffixed on collision).

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import { restoreTrash } from '@/lib/notes/store'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  const id = typeof body.id === 'string' ? body.id : null
  if (!id) return fail('id is required')
  try {
    return NextResponse.json({ path: await restoreTrash(brain, id) })
  } catch (err) {
    return failFromError(err)
  }
}
