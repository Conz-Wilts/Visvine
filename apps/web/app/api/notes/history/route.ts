// Per-note revision history.
//   GET  /api/notes/history?spaceId=&scope=&path=   → { revisions }  (newest first)
//   POST { spaceId, scope, path, revisionId }        → { ok }         (restore a version)
//
// Both halves are gated on the NOTE, not just on space membership: a revision
// carries the full body it was taken from, so an ungated history read is an
// ungated note read, and restoring one is a whole-note write. The GET goes
// through readVisible so an unreadable note is indistinguishable from an absent
// one (and a restricted read gets audited); the POST takes the same
// writeDenialFull bar as PUT /api/notes/item, which is the write it performs.

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/resolve'
import { readVisible, writeDenialFull } from '@/lib/notes/contextService'
import { listRevisions, applyRevision } from '@/lib/notes/store'

export async function GET(req: NextRequest) {
  const context = await requireContext(req)
  if (context instanceof Response) return context
  const path = new URL(req.url).searchParams.get('path')
  if (!path) return fail('path is required')
  const p = await principalOf(context)
  if ((await readVisible(p, context, path)) === null) {
    return fail(`Note not found: ${path}`, 404)
  }
  return NextResponse.json({ revisions: await listRevisions(context, path) })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  const path = typeof body.path === 'string' ? body.path : null
  const revisionId = typeof body.revisionId === 'string' ? body.revisionId : null
  if (!path || !revisionId) return fail('path and revisionId are required')
  const p = await principalOf(context)
  const denial = await writeDenialFull(p, context, path)
  if (denial) return fail(denial, 403)
  try {
    await applyRevision(context, path, revisionId, context.actor)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return failFromError(err)
  }
}
