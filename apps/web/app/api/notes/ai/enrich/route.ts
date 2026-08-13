// POST /api/notes/ai/enrich
//   { spaceId, since?, only? } → { applied, considered }
// On-demand enrichment: distills the CALLER's own personal brain into the
// space's shared brain (abstracted insight, provenance-stamped, applied
// through the gated write path as the caller). 400 when no LLM is configured.

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import { principalOf, resolvePersonalBrain } from '@/lib/notes/brain'
import { runEnrichment } from '@/lib/notes/enrich'
import { aiConfigured } from '@/lib/notes/ai'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  if (!aiConfigured()) return fail('AI is not configured')
  const since = typeof body.since === 'number' ? body.since : undefined
  const only = typeof body.only === 'string' ? body.only : undefined
  const p = await principalOf(brain)
  // Enrichment reads the caller's PERSONAL SPACE brain and writes distilled
  // insight into the resolved space's brain (as the caller, gated).
  const personal = await resolvePersonalBrain({ userId: p.userId, name: p.name, email: p.email || null })
  try {
    return NextResponse.json(await runEnrichment(p, personal, { trigger: 'on-demand', since, only }))
  } catch (err) {
    return failFromError(err)
  }
}
