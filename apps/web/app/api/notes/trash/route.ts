// GET /api/notes/trash?spaceId=&scope=
// The soft-deleted notes for a context (newest first), for the trash modal.

import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/notes/api'
import { listTrash } from '@/lib/notes/store'

export async function GET(req: NextRequest) {
  const context = await requireContext(req)
  if (context instanceof Response) return context
  return NextResponse.json({ trash: await listTrash(context) })
}
