import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/session'
import { directoryOpenTo, listingSource } from '@/lib/tools/directory'
import type { ListingSourceResponse } from '@/lib/tools/api'

/**
 * `GET /api/tools/directory/<listingId>/source` — what an installing admin
 * would run, read before they run it. Anyone who administers a space may.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params
  const session = await requireSession()
  if (session instanceof Response) return session
  if (!directoryOpenTo(session.email)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const source = await listingSource(listingId, { userId: session.userId, email: session.email })
  if (!source) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const body: ListingSourceResponse = source
  return NextResponse.json(body)
}
