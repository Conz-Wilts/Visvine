import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/session'
import { replyToQuestion, unreadCount } from '@/lib/notifications/service'

export const dynamic = 'force-dynamic'

/**
 * `POST { text }` — answer an `agent_question` notification. The reply is
 * queued as a `reply` event for the agent that asked (it arrives in that
 * agent's next run) and the line is marked read. Only the row's owner can
 * answer; anything else is a 404.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  if (session instanceof Response) return session
  const { id } = await params
  let body: { text?: unknown } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    body = {}
  }
  const text = typeof body.text === 'string' ? body.text : ''
  const result = await replyToQuestion(session.userId, id, text)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, unread: await unreadCount(session.userId) })
}
