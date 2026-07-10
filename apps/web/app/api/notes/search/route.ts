// POST /api/notes/search
//   { communityId, scope, query, k?, filters? } → { results: FusedResult[] }
// Fused retrieval (frontmatter filter → BM25 → pgvector → link graph, RRF) over
// everything the caller can read in the brain; the visibility lens and the
// private-folder read audit are applied inside brainService.searchBrain.

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/brain'
import { searchBrain } from '@/lib/notes/brainService'
import type { SearchFilters } from '@/lib/notes/shared/retrieval'

function parseFilters(raw: unknown): SearchFilters {
  if (typeof raw !== 'object' || raw === null) return {}
  const f = raw as Record<string, unknown>
  return {
    type: typeof f.type === 'string' ? f.type : undefined,
    folderId: typeof f.folderId === 'string' ? f.folderId : undefined,
    tags: Array.isArray(f.tags) ? f.tags.map(String) : undefined,
    updatedAfter: typeof f.updatedAfter === 'number' ? f.updatedAfter : undefined,
    updatedBefore: typeof f.updatedBefore === 'number' ? f.updatedBefore : undefined,
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  const query = typeof body.query === 'string' ? body.query : null
  if (!query) return fail('query is required')
  const k = typeof body.k === 'number' ? body.k : undefined
  const p = await principalOf(brain)
  try {
    const results = await searchBrain(p, brain, query, parseFilters(body.filters), k)
    return NextResponse.json({ results })
  } catch (err) {
    return failFromError(err)
  }
}
