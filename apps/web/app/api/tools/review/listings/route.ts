import { NextResponse } from 'next/server'
import { isSuperAdmin, requireSession } from '@/lib/session'
import { listListings } from '@/lib/tools/reviewConsole'

/** `GET /api/tools/review/listings` — every listing, its state and its publisher. Reviewers only. */
export async function GET() {
  const session = await requireSession()
  if (session instanceof Response) return session
  if (!isSuperAdmin(session.email)) return NextResponse.json({ error: 'Only Visvine reviewers.' }, { status: 403 })
  return NextResponse.json({ listings: await listListings() })
}
