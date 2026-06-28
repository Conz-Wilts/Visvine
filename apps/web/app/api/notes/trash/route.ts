// GET /api/notes/trash?communityId=&scope=
// The soft-deleted notes for a brain (newest first), for the trash modal.

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain } from '@/lib/notes/api'
import { listTrash } from '@/lib/notes/store'

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  return NextResponse.json({ trash: await listTrash(brain) })
}
