// GET /api/notes/trash?spaceId=&scope=
// The soft-deleted notes for a context (newest first), for the trash modal.
//
// Filtered through the same visibility lens as the vault index: a trashed note
// carries its original path, so an unfiltered listing would leak the names of
// notes in folders the caller cannot read (exactly what filterVisible exists to
// prevent). listTrash itself stays permission-free — the storage layer answers
// "what is trashed", the route answers "what may you see".

import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/resolve'
import { canReadPath } from '@/lib/notes/contextService'
import { listTrash } from '@/lib/notes/store'

export async function GET(req: NextRequest) {
  const context = await requireContext(req)
  if (context instanceof Response) return context
  const p = await principalOf(context)
  const trash = await listTrash(context)
  return NextResponse.json({ trash: trash.filter((t) => canReadPath(p, context, t.path)) })
}
