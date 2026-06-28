// POST /api/notes/pin  { communityId, scope, path, pinned } → { ok }
// Pin / unpin a note (sidebar "Pinned" section).

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import { setPinned } from '@/lib/notes/store'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  const path = typeof body.path === 'string' ? body.path : null
  if (!path) return fail('path is required')
  try {
    await setPinned(brain, path, Boolean(body.pinned))
    return NextResponse.json({ ok: true })
  } catch (err) {
    return failFromError(err)
  }
}
