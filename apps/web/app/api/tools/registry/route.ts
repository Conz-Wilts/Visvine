import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/session'
import { browseVersions } from '@/lib/tools/registry'
import { listInstalls } from '@/lib/tools/installs'
import { requireToolsAccess } from '@/lib/tools/route'
import type { BrowseItem, BrowseResponse } from '@/lib/tools/api'

/**
 * The marketplace catalogue: the latest APPROVED version of every Tool, newest
 * publication first, filtered by `?q=` and paged by `?cursor=`.
 *
 * Global on purpose — the registry is one shared shelf, and a Tool published by
 * another space is exactly what a browser is here to find. Signed-in only: an
 * approved Tool's declared reach and author are not public.
 *
 * `?spaceId=` adds `installedInSpace` to each row, so the Browse tab can badge
 * what this space already runs. That flag is space data, so a named space is
 * gated like the install routes are — membership plus the `tools` feature key.
 * The catalogue itself needs only a session.
 */
export async function GET(req: NextRequest) {
  const spaceId = req.nextUrl.searchParams.get('spaceId')?.trim() ?? ''
  const gate = spaceId ? await requireToolsAccess(spaceId) : await requireSession()
  if (gate instanceof Response) return gate

  const params = req.nextUrl.searchParams
  const page = await browseVersions({
    q: params.get('q')?.trim() || undefined,
    cursor: params.get('cursor')?.trim() || undefined,
  })

  const installed = spaceId ? new Set((await listInstalls(spaceId)).map((row) => row.key)) : null
  const versions: BrowseItem[] = page.items.map((item) =>
    installed ? { ...item, installedInSpace: installed.has(item.key) } : item,
  )

  const body: BrowseResponse = { versions, nextCursor: page.nextCursor }
  return NextResponse.json(body)
}
