// Per-note revision history.
//   GET  /api/notes/history?spaceId=&scope=&path=   → { revisions }  (newest first)
//   POST { spaceId, scope, path, revisionId }        → { ok }         (restore a version)

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { listRevisions, applyRevision } from '@/lib/notes/store'

export async function GET(req: NextRequest) {
  const context = await requireContext(req)
  if (context instanceof Response) return context
  const path = new URL(req.url).searchParams.get('path')
  if (!path) return fail('path is required')
  return NextResponse.json({ revisions: await listRevisions(context, path) })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  const path = typeof body.path === 'string' ? body.path : null
  const revisionId = typeof body.revisionId === 'string' ? body.revisionId : null
  if (!path || !revisionId) return fail('path and revisionId are required')
  try {
    await applyRevision(context, path, revisionId, context.actor)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return failFromError(err)
  }
}
