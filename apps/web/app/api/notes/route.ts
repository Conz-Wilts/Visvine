// GET /api/notes?communityId=&scope=shared|personal
// The note index for a brain: enriched NoteMeta[] (titles, tags, resolved links,
// broken links) plus the pinned paths. Drives the sidebar, tag chips, and the
// note list. Reads only — see /item for mutations.

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain } from '@/lib/notes/api'
import { listRaw, listPinned } from '@/lib/notes/store'
import { buildNoteIndex } from '@/lib/notes/shared/graph'

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  const [raw, pinned] = await Promise.all([listRaw(brain), listPinned(brain)])
  return NextResponse.json({ notes: buildNoteIndex(raw), pinned })
}
