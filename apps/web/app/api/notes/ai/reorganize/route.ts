// POST /api/notes/ai/reorganize  { spaceId, scope } → { plan }
// Proposes a folder reorganization for the context (never applied here — the client
// reviews the moves and applies accepted ones via PATCH /api/notes/item).
// In the shared context this is admin-only (restructuring shared content).

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { aiConfigured, reorganizeNotes } from '@/lib/notes/ai'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  if (!aiConfigured()) return fail('AI is not configured', 404)
  if (context.scope === 'shared' && !context.isAdmin) {
    return fail('Only an admin can reorganize the space context', 403)
  }
  try {
    return NextResponse.json({ plan: await reorganizeNotes(context) })
  } catch (err) {
    return failFromError(err)
  }
}
