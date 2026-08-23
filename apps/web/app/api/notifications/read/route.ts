import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/session'
import { markRead, unreadCounts } from '@/lib/notifications/service'
import { parseScope } from '@/lib/notifications/types'

export const dynamic = 'force-dynamic'

/**
 * `POST { ids?: string[], all?: boolean, scope?, spaceId? }` — mark the
 * caller's own lines read. Only their rows can ever match (the query is scoped
 * by session user id), so a foreign id is simply a no-op. With `all`, the
 * optional scope limits it to the tab the bell is showing. Answers with the
 * fresh unread counts.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession()
  if (session instanceof Response) return session
  let body: { ids?: unknown; all?: unknown; scope?: unknown; spaceId?: unknown } = {}
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
  const spaceId = typeof body.spaceId === 'string' && body.spaceId.trim() ? body.spaceId.trim() : null
  const scope = parseScope(typeof body.scope === 'string' ? body.scope : null)
  const { updated } = await markRead(session.userId, all ? { all: true, scope, spaceId } : { ids })
  const counts = await unreadCounts(session.userId, spaceId)
  return NextResponse.json({
    updated,
    unread: counts.total,
    unreadGlobal: counts.global,
    unreadSpace: counts.space,
  })
}
