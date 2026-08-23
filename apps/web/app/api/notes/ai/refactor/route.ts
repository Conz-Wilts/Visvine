// POST /api/notes/ai/refactor
//   { mode: 'note', text }                        → { result }   (rewrite a whole note body)
//   { mode: 'selection', text, instruction? }     → { result }   (rewrite a snippet)
// Returns 404 when no LLM backend is configured so the client hides the feature.
//
// This is the only LLM endpoint any member can reach — reorganize and the
// connectors agent are both admin-gated — and it needs no context permission,
// because the caller sends text they already hold rather than naming a note to
// read. What it does need is a budget: chat() forwards the prompt to the
// provider verbatim, with no truncation and no max_tokens, so an uncapped body
// is an uncapped bill. Hence a per-user token bucket and a hard length cap.

import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/session'
import { fail, failFromError } from '@/lib/notes/api'
import { takeToken, type RateLimitConfig } from '@/lib/rateLimit'
import { aiConfigured, refactorNote, refactorText } from '@/lib/notes/ai'

/**
 * Interactive editing, so the burst matters more than the sustained rate: a
 * writer may rewrite several paragraphs in a row, then stop. 10 back-to-back
 * then one every 5s is comfortable for a person at the keyboard and useless as
 * a way to spend someone else's model quota in a loop.
 */
const REFACTOR_LIMIT: RateLimitConfig = { capacity: 10, refillPerSec: 0.2 }

/** ~25k tokens of markdown — larger than any real note, and a firm ceiling on
 *  the cost of a single call. */
const MAX_TEXT_CHARS = 100_000
/** The instruction rides in the system prompt; it is a sentence, not a corpus. */
const MAX_INSTRUCTION_CHARS = 2_000

export async function POST(req: NextRequest) {
  const session = await requireSession()
  if (session instanceof Response) return session
  if (!aiConfigured()) return fail('AI is not configured', 404)

  const body = await req.json().catch(() => ({}))
  const text = typeof body.text === 'string' ? body.text : null
  if (text === null) return fail('text is required')
  if (text.length > MAX_TEXT_CHARS) {
    return fail(
      `That's too much text to rewrite at once (${text.length} characters, limit ${MAX_TEXT_CHARS}). Select a smaller passage.`,
    )
  }
  const instruction = typeof body.instruction === 'string' ? body.instruction : undefined
  if (instruction !== undefined && instruction.length > MAX_INSTRUCTION_CHARS) {
    return fail(`Keep the instruction under ${MAX_INSTRUCTION_CHARS} characters.`)
  }

  // Metered per user, not per IP: the caller is authenticated, and one office
  // behind one NAT address must not share a single budget.
  const limit = await takeToken(`ai:refactor:${session.userId}`, REFACTOR_LIMIT)
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Rewriting a lot at once — try again in ${Math.ceil(limit.retryAfterMs / 1000)}s.` },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limit.retryAfterMs / 1000)) } },
    )
  }

  try {
    const result =
      body.mode === 'selection' ? await refactorText(text, instruction) : await refactorNote(text)
    return NextResponse.json({ result })
  } catch (err) {
    return failFromError(err)
  }
}
