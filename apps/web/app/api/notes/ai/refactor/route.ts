// POST /api/notes/ai/refactor
//   { mode: 'note', text }                        → { result }   (rewrite a whole note body)
//   { mode: 'selection', text, instruction? }     → { result }   (rewrite a snippet)
// Returns 404 when no LLM backend is configured so the client hides the feature.

import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/session'
import { fail, failFromError } from '@/lib/notes/api'
import { aiConfigured, refactorNote, refactorText } from '@/lib/notes/ai'

export async function POST(req: NextRequest) {
  const session = await requireSession()
  if (session instanceof Response) return session
  if (!aiConfigured()) return fail('AI is not configured', 404)

  const body = await req.json().catch(() => ({}))
  const text = typeof body.text === 'string' ? body.text : null
  if (text === null) return fail('text is required')
  const instruction = typeof body.instruction === 'string' ? body.instruction : undefined

  try {
    const result =
      body.mode === 'selection' ? await refactorText(text, instruction) : await refactorNote(text)
    return NextResponse.json({ result })
  } catch (err) {
    return failFromError(err)
  }
}
