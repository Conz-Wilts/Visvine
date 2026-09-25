import { NextRequest, NextResponse } from 'next/server'
import { isSuperAdmin, requireSession } from '@/lib/session'
import { refreshAdvisories } from '@/lib/tools/advisories'
import { rescanListed } from '@/lib/tools/rescan'

/**
 * `POST /api/tools/review/rescan` — what the nightly pass does, now: the
 * advisory feed, then every listed version the rules or the feed moved under
 * (all of them with `{ force: true }`). Reviewers only.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession()
  if (session instanceof Response) return session
  if (!isSuperAdmin(session.email)) return NextResponse.json({ error: 'Only Visvine reviewers.' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { force?: unknown }
  const feed = await refreshAdvisories()
  const rescan = await rescanListed({ force: body.force === true, packages: feed.changed })
  return NextResponse.json({ ...feed, ...rescan })
}
