import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { handleApiError, requireApiSession } from '@/lib/api/route'
import { listActivityForUser } from '@/lib/activity/service'
import { ACTIVITY_PAGE_MAX } from '@/lib/activity/shared/fold'

const querySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(ACTIVITY_PAGE_MAX).optional(),
})

/**
 * GET /api/activity — the phone's Activity tab (docs/mobile.md): runs that
 * acted for you, mentions and replies, requests you can answer, and (first
 * page) the events you are going to. Keyset paged on `at|id`. Mirrored by
 * the mobile clients' `ActivityPage`.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession()
    if (session instanceof NextResponse) return session
    const { searchParams } = new URL(request.url)
    const query = querySchema.safeParse({ cursor: searchParams.get('cursor') ?? undefined, limit: searchParams.get('limit') ?? undefined })
    if (!query.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 })
    return NextResponse.json(await listActivityForUser(session, query.data))
  } catch (error) {
    return handleApiError(error, 'activity.list.failed')
  }
}
