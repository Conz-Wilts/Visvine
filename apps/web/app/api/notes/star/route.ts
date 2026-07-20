// POST /api/notes/star  { communityId, scope, path, starred } → { ok }
// Star / unstar a note (sidebar "Starred" section + editor toolbar star).
// Rewrites the note's frontmatter `starred:` flag — the same state the editor
// toggles — so both surfaces always agree.

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import { setStarred } from '@/lib/notes/store'
import { principalOf } from '@/lib/notes/brain'
import { writeDenial } from '@/lib/notes/brainService'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  const path = typeof body.path === 'string' ? body.path : null
  if (!path) return fail('path is required')
  // Starring rewrites the note's frontmatter, so it needs write access like any
  // other content edit.
  const p = await principalOf(brain)
  const denial = writeDenial(p, brain, path)
  if (denial) return fail(denial, 403)
  try {
    await setStarred(brain, path, Boolean(body.starred), brain.actor)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return failFromError(err)
  }
}
