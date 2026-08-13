// POST /api/notes/ai/enrich
//   { spaceId, since?, only? } → { applied, considered }
// On-demand enrichment: distills the CALLER's own personal context into the
// space's shared context (abstracted insight, provenance-stamped, applied
// through the gated write path as the caller). 400 when no LLM is configured.

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { principalOf, resolvePersonalContext } from '@/lib/notes/resolve'
import { runEnrichment } from '@/lib/notes/enrich'
import { aiConfigured } from '@/lib/notes/ai'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  if (!aiConfigured()) return fail('AI is not configured')
  const since = typeof body.since === 'number' ? body.since : undefined
  const only = typeof body.only === 'string' ? body.only : undefined
  const p = await principalOf(context)
  // Enrichment reads the caller's PERSONAL SPACE context and writes distilled
  // insight into the resolved space's context (as the caller, gated).
  const personal = await resolvePersonalContext({ userId: p.userId, name: p.name, email: p.email || null })
  try {
    return NextResponse.json(await runEnrichment(p, personal, { trigger: 'on-demand', since, only }))
  } catch (err) {
    return failFromError(err)
  }
}
