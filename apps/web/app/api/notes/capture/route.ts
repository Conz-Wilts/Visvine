// POST /api/notes/capture — quick capture, two forms:
//   { spaceId, text, refs?, tags? }        → { path }  — append a dated line
//        to the caller's private monthly log (their PERSONAL SPACE's context,
//        whatever space the request came from).
//   { spaceId, path, entry }               → { path }  — append a dated `## Log`
//        entry to an existing note in the resolved context (gated; denied → 403).

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { principalOf, resolvePersonalContext } from '@/lib/notes/resolve'
import { appendCapture, appendNoteBound } from '@/lib/notes/capture'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  const p = await principalOf(context)

  try {
    // Note-bound form: append to an existing note through the gated write path.
    if (typeof body.path === 'string' && typeof body.entry === 'string') {
      const result = await appendNoteBound(p, context, body.path, body.entry)
      if (result.status === 'denied') return fail(result.reason, 403)
      return NextResponse.json({ path: result.path })
    }

    const text = typeof body.text === 'string' ? body.text : null
    if (!text) return fail('text is required (or path + entry for a note-bound log)')
    const refs = Array.isArray(body.refs) ? body.refs.map(String) : undefined
    const tags = Array.isArray(body.tags) ? body.tags.map(String) : undefined
    // Captures always land in the caller's personal space's log, whatever
    // space the request resolved.
    const personal = await resolvePersonalContext({ userId: p.userId, name: p.name, email: p.email || null })
    return NextResponse.json({ path: await appendCapture(p, personal, text, refs, tags) })
  } catch (err) {
    return failFromError(err)
  }
}
