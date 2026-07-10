// GET /api/notes/graph?communityId=&scope=
// The force-directed link graph for a brain (notes as nodes, resolved OKF links
// as edges) plus connectivity insights (orphans / hubs) and the tag counts the
// graph view's filters use. Built over the visibility-filtered vault, so private
// folders the caller can't read contribute no nodes, edges, or tags. Filtering
// by folder/focus happens client-side via shared/graph.filterGraph.

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/brain'
import { visibleVault } from '@/lib/notes/brainService'
import { buildGraph } from '@/lib/notes/shared/graph'
import { linkInsights, collectTags } from '@/lib/notes/shared/insights'

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  const p = await principalOf(brain)
  const { metas } = await visibleVault(p, brain)
  return NextResponse.json({
    graph: buildGraph(metas),
    insights: linkInsights(metas),
    tags: collectTags(metas),
  })
}
