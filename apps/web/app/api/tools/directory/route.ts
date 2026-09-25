import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/session'
import { browseListings, directoryOpenTo } from '@/lib/tools/directory'
import type { DirectoryResponse } from '@/lib/tools/api'

/**
 * `GET /api/tools/directory?q=&cursor=` — Discover's Tools: every listing
 * Visvine lists, most installed first (lib/tools/directory.ts). Outside every
 * space, like Discover's Spaces and Events.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession()
  if (session instanceof Response) return session
  if (!directoryOpenTo(session.email)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const params = req.nextUrl.searchParams
  const page = await browseListings({ q: params.get('q') ?? undefined, cursor: params.get('cursor') ?? undefined })
  const body: DirectoryResponse = page
  return NextResponse.json(body)
}
