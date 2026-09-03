// GET /api/notes?spaceId=&scope=shared|personal
// The note index for a context: enriched NoteMeta[] (titles, tags, resolved links,
// broken links). Reads only — see /item for mutations.
// Shared-context reads go through the visibility lens, so private folders the
// caller doesn't belong to never appear (personal contexts pass through unfiltered).
// A public sub-space's index rides along under `spaces/<id>/` (lib/notes/federation.ts).

import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/resolve'
import { federatedMetas } from '@/lib/notes/federation'

export async function GET(req: NextRequest) {
  const context = await requireContext(req)
  if (context instanceof Response) return context
  const p = await principalOf(context)
  return NextResponse.json({ notes: await federatedMetas(p, context) })
}
