// POST /api/notes/search
//   { spaceId, scope, query, k?, filters?, rewrite? } → { results: FusedResult[], semantic, plan }
// Fused retrieval (query plan → frontmatter/date filter → BM25 → pgvector →
// chunks → link context, weighted RRF) over
// everything the caller can read in the context; the visibility lens and the
// private-folder read audit are applied inside contextService.searchContext;
// a public sub-space's notes rank alongside, under `subspaces/<id>/`
// (lib/notes/federation.ts).

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/resolve'
import { searchFederated } from '@/lib/notes/federation'
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
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  const query = typeof body.query === 'string' ? body.query : null
  if (!query) return fail('query is required')
  const k = typeof body.k === 'number' ? body.k : undefined
  const p = await principalOf(context)
  try {
    const rewrite = typeof body.rewrite === 'boolean' ? body.rewrite : undefined
    const { hits, semantic, plan, answerable } = await searchFederated(p, context, query, parseFilters(body.filters), k, {
      rewrite,
      // A person scanning rows as they type wants them now; a caller that
      // wants only what is about the query asks for the judge.
      judge: body.judge === true,
    })
    // `semantic` says whether the embedding stages actually ran — 'no-key' means
    // these results are keyword + link context only; `plan` says what the query
    // was read as (phrasings, date range, history intent).
    return NextResponse.json({ results: hits, semantic, plan, ...(answerable === undefined ? {} : { answerable }) })
  } catch (err) {
    return failFromError(err)
  }
}
