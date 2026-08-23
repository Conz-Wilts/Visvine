import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/session'
import { listNotifications, unreadCounts } from '@/lib/notifications/service'
import { clampTake, parseScope } from '@/lib/notifications/types'

export const dynamic = 'force-dynamic'

/**
 * The caller's inbox: `?unread=1` for open lines only, `?take=` up to 100
 * (default 30), `?scope=global|space` with `?spaceId=` to ask for one half of
 * it (default: everything). Always carries the unread counts — total, global
 * and this space's — so the bell's badge, its two tabs and the list all come
 * from one round-trip.
 *
 * `spaceId` is not authorised here on purpose: these are the caller's OWN rows,
 * filtered by a label they already hold. Naming a space they aren't in returns
 * nothing rather than anything of that space's.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession()
  if (session instanceof Response) return session
  const params = req.nextUrl.searchParams
  const unreadOnly = params.get('unread') === '1' || params.get('unread') === 'true'
  const take = clampTake(params.get('take'))
  const scope = parseScope(params.get('scope'))
  const spaceId = params.get('spaceId')?.trim() || null
  const [notifications, counts] = await Promise.all([
    listNotifications(session.userId, { unreadOnly, take, scope, spaceId }),
    unreadCounts(session.userId, spaceId),
  ])
  return NextResponse.json({
    notifications,
    unread: counts.total,
    unreadGlobal: counts.global,
    unreadSpace: counts.space,
  })
}
