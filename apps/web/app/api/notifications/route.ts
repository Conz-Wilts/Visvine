import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/session'
import { listNotifications, unreadCount } from '@/lib/notifications/service'
import { clampTake } from '@/lib/notifications/types'

export const dynamic = 'force-dynamic'

/**
 * The caller's inbox: `?unread=1` for open lines only, `?take=` up to 100
 * (default 30). Always carries the unread count so the bell badge and the
 * list come from one round-trip.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession()
  if (session instanceof Response) return session
  const params = req.nextUrl.searchParams
  const unreadOnly = params.get('unread') === '1' || params.get('unread') === 'true'
  const take = clampTake(params.get('take'))
  const [notifications, unread] = await Promise.all([
    listNotifications(session.userId, { unreadOnly, take }),
    unreadCount(session.userId),
  ])
  return NextResponse.json({ notifications, unread })
}
