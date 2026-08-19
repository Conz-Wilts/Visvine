import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/session'
import { markRead, unreadCount } from '@/lib/notifications/service'

export const dynamic = 'force-dynamic'

/**
 * `POST { ids?: string[], all?: boolean }` — mark the caller's own lines read.
 * Only their rows can ever match (the query is scoped by session user id), so
 * a foreign id is simply a no-op. Answers with the fresh unread count.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession()
  if (session instanceof Response) return session
  let body: { ids?: unknown; all?: unknown } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    body = {}
  }
  const all = body.all === true
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string') : []
  if (!all && ids.length === 0) {
    return NextResponse.json({ error: 'Pass ids or all: true' }, { status: 400 })
  }
  const { updated } = await markRead(session.userId, all ? { all: true } : { ids })
  return NextResponse.json({ updated, unread: await unreadCount(session.userId) })
}
