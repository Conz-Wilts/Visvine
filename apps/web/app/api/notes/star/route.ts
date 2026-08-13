// POST /api/notes/star  { spaceId, scope, path, starred } → { ok }
// Star / unstar a note (sidebar "Starred" section + editor toolbar star).
// Rewrites the note's frontmatter `starred:` flag — the same state the editor
// toggles — so both surfaces always agree.

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { setStarred } from '@/lib/notes/store'
import { principalOf } from '@/lib/notes/resolve'
import { writeDenial } from '@/lib/notes/contextService'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  const path = typeof body.path === 'string' ? body.path : null
  if (!path) return fail('path is required')
  // Starring rewrites the note's frontmatter, so it needs write access like any
  // other content edit.
  const p = await principalOf(context)
  const denial = writeDenial(p, context, path)
  if (denial) return fail(denial, 403)
  try {
    await setStarred(context, path, Boolean(body.starred), context.actor)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return failFromError(err)
  }
}
