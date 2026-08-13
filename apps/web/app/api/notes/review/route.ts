// POST /api/notes/review
//   { spaceId, scope, mode: 'light'|'full', apply? } → { report, applied }
// Runs the review checks over the context; `apply` also writes the allow-listed
// reversible auto-fixes (locked folders stay frozen). Applying to the SHARED
// context restructures space content, so it's space-admin only; a personal
// context is always its owner's to review.

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/resolve'
import { runReview } from '@/lib/notes/reviewRun'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  if (context.scope === 'shared' && !context.isAdmin) {
    return fail('Only an admin can run a review over the space context', 403)
  }
  const mode = body.mode === 'full' ? 'full' : 'light'
  const p = await principalOf(context)
  try {
    return NextResponse.json(await runReview(p, context, mode, body.apply === true))
  } catch (err) {
    return failFromError(err)
  }
}
