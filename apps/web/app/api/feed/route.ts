import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError, requireApiSession } from '@/lib/api/route';
import { listFeedForUser } from '@/lib/messages/feedService';
import { FEED_PAGE_MAX } from '@/lib/messages/shared/feed';

const querySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(FEED_PAGE_MAX).optional(),
  /** One space's feed only — what the phone's Home asks for. */
  spaceId: z.string().max(200).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;

    const { searchParams } = new URL(request.url);
    const query = querySchema.safeParse({
      cursor: searchParams.get('cursor') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      spaceId: searchParams.get('spaceId') ?? undefined,
    });
    if (!query.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 });

    const page = await listFeedForUser({ id: session.userId, email: session.email }, query.data);
    return NextResponse.json(page);
  } catch (error) {
    return handleApiError(error, 'feed.list.failed');
  }
}
