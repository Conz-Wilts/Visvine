// GET /api/notes/graph?communityId=&scope=
// The force-directed link graph for a brain (notes as nodes, resolved OKF links
// as edges) plus connectivity insights (orphans / hubs) and the tag counts the
// graph view's filters use. Filtering by folder/focus happens client-side via
// shared/graph.filterGraph so panning the neighbourhood needs no round-trip.

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain } from '@/lib/notes/api'
import { listRaw } from '@/lib/notes/store'
import { buildNoteIndex, buildGraph } from '@/lib/notes/shared/graph'
import { linkInsights, collectTags } from '@/lib/notes/shared/insights'

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  const index = buildNoteIndex(await listRaw(brain))
  return NextResponse.json({
    graph: buildGraph(index),
    insights: linkInsights(index),
    tags: collectTags(index),
  })
}
