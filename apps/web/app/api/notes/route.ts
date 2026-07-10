// GET /api/notes?communityId=&scope=shared|personal
// The note index for a brain: enriched NoteMeta[] (titles, tags, resolved links,
// broken links) plus the pinned paths. Reads only — see /item for mutations.
// Shared-brain reads go through the visibility lens, so private folders the
// caller doesn't belong to never appear (personal brains pass through unfiltered).

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/brain'
import { visibleVault, canReadPath } from '@/lib/notes/brainService'
import { listPinned } from '@/lib/notes/store'

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  const p = await principalOf(brain)
  const [{ metas }, pinned] = await Promise.all([visibleVault(p, brain), listPinned(brain)])
  return NextResponse.json({
    notes: metas,
    pinned: pinned.filter((path) => canReadPath(p, brain, path)),
  })
}
