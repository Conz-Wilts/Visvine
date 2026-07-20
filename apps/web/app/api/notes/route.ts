// GET /api/notes?communityId=&scope=shared|personal
// The note index for a brain: enriched NoteMeta[] (titles, tags, resolved links,
// broken links) plus the starred paths. Reads only — see /item for mutations.
// Shared-brain reads go through the visibility lens, so private folders the
// caller doesn't belong to never appear (personal brains pass through unfiltered).

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/brain'
import { visibleVault, canReadPath } from '@/lib/notes/brainService'
import { listStarred } from '@/lib/notes/store'

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  const p = await principalOf(brain)
  const [{ metas }, starred] = await Promise.all([visibleVault(p, brain), listStarred(brain)])
  return NextResponse.json({
    notes: metas,
    starred: starred.filter((path) => canReadPath(p, brain, path)),
  })
}
