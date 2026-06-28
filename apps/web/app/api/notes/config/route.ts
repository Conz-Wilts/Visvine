// GET /api/notes/config
// Which optional affordances to surface this session. Currently just whether an
// LLM backend is configured, so the client can hide the refactor/reorganize UI.

import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/session'
import { aiConfigured } from '@/lib/notes/ai'

export async function GET() {
  const session = await requireSession()
  if (session instanceof Response) return session
  return NextResponse.json({ aiConfigured: aiConfigured() })
}
