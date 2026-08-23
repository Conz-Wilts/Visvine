// POST /api/notes/trash/restore  { spaceId, scope, id } → { path }
// Restore a soft-deleted note to its original path (suffixed on collision).
//
// A restore is a WRITE at the note's original path — it relists the note in its
// folder and rebuilds its projections — so it is held to the same write gate as
// editing that path. An entry the caller cannot read 404s exactly like an
// unknown id, so the response never reveals that a note they can't see exists
// in the trash. (Its destructive siblings, trash/empty and trash/purge, are
// admin-gated; restore was the one door left unlocked.)

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/resolve'
import { canReadPath, writeDenial } from '@/lib/notes/contextService'
import { listTrash, restoreTrash } from '@/lib/notes/store'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  const id = typeof body.id === 'string' ? body.id : null
  if (!id) return fail('id is required')
  const p = await principalOf(context)

  // Resolve the entry first so the gate can see where it would land.
  const entry = (await listTrash(context)).find((t) => t.id === id)
  if (!entry || !canReadPath(p, context, entry.path)) {
    return fail('Trash entry not found', 404)
  }
  const denial = writeDenial(p, context, entry.path)
  if (denial) return fail(denial, 403)

  try {
    return NextResponse.json({ path: await restoreTrash(context, id) })
  } catch (err) {
    return failFromError(err)
  }
}
