// GET /api/notes/trash/item?spaceId=&id=  → { path, title, content, deletedAt }
// One trashed note, for the read-only preview behind a trash row.
//
// Reading a trashed note is a READ at its original path, so it is held to the
// same lens the listing is: an entry the caller cannot read 404s exactly like an
// unknown id, so the response never reveals that a note they can't see is
// sitting in the trash. (Its siblings differ on purpose — restore is gated on
// WRITE at the path, since it puts the note back; empty and purge are
// admin-gated. Only this one is a pure read.)

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/resolve'
import { canReadPath } from '@/lib/notes/contextService'
import { listTrash, readTrashedNote } from '@/lib/notes/store'

export async function GET(req: NextRequest) {
  const context = await requireContext(req)
  if (context instanceof Response) return context
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return fail('id is required')
  const p = await principalOf(context)

  // Resolve through the listing first, so the read gate sees the entry's
  // original path — the same order restore uses.
  const entry = (await listTrash(context)).find((t) => t.id === id)
  if (!entry || !canReadPath(p, context, entry.path)) {
    return fail('Trash entry not found', 404)
  }

  const note = await readTrashedNote(context, id)
  if (!note) return fail('Trash entry not found', 404)
  return NextResponse.json(note)
}
