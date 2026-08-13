// POST /api/notes/trash/restore  { spaceId, scope, id } → { path }
// Restore a soft-deleted note to its original path (suffixed on collision).

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { restoreTrash } from '@/lib/notes/store'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  const id = typeof body.id === 'string' ? body.id : null
  if (!id) return fail('id is required')
  try {
    return NextResponse.json({ path: await restoreTrash(context, id) })
  } catch (err) {
    return failFromError(err)
  }
}
