// GET /api/notes?spaceId=&scope=shared|personal
// The note index for a context: enriched NoteMeta[] (titles, tags, resolved links,
// broken links) plus the starred paths. Reads only — see /item for mutations.
// Shared-context reads go through the visibility lens, so private folders the
// caller doesn't belong to never appear (personal contexts pass through unfiltered).

import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/resolve'
import { visibleVault, canReadPath } from '@/lib/notes/contextService'
import { listStarred } from '@/lib/notes/store'

export async function GET(req: NextRequest) {
  const context = await requireContext(req)
  if (context instanceof Response) return context
  const p = await principalOf(context)
  const [{ metas }, starred] = await Promise.all([visibleVault(p, context), listStarred(context)])
  return NextResponse.json({
    notes: metas,
    starred: starred.filter((path) => canReadPath(p, context, path)),
  })
}
