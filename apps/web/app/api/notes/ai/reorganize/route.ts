// POST /api/notes/ai/reorganize  { communityId, scope } → { plan }
// Proposes a folder reorganization for the brain (never applied here — the client
// reviews the moves and applies accepted ones via PATCH /api/notes/item).
// In the shared brain this is admin-only (restructuring shared content).

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import { aiConfigured, reorganizeNotes } from '@/lib/notes/ai'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  if (!aiConfigured()) return fail('AI is not configured', 404)
  if (brain.scope === 'shared' && !brain.isAdmin) {
    return fail('Only an admin can reorganize the community brain', 403)
  }
  try {
    return NextResponse.json({ plan: await reorganizeNotes(brain) })
  } catch (err) {
    return failFromError(err)
  }
}
