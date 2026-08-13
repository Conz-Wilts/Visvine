// POST /api/notes/review
//   { spaceId, scope, mode: 'light'|'full', apply? } → { report, applied }
// Runs the review checks over the brain; `apply` also writes the allow-listed
// reversible auto-fixes (locked folders stay frozen). Applying to the SHARED
// brain restructures space content, so it's space-admin only; a personal
// brain is always its owner's to review.

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/brain'
import { runReview } from '@/lib/notes/reviewRun'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  if (brain.scope === 'shared' && !brain.isAdmin) {
    return fail('Only an admin can run a review over the space brain', 403)
  }
  const mode = body.mode === 'full' ? 'full' : 'light'
  const p = await principalOf(brain)
  try {
    return NextResponse.json(await runReview(p, brain, mode, body.apply === true))
  } catch (err) {
    return failFromError(err)
  }
}
