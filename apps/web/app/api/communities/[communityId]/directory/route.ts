/**
 * Directory data API — nodes only (no links).
 *
 * The grid/table directory views never render the link graph, so they fetch this
 * lightweight endpoint instead of /graph. Backed by the same `graph-data-v2`
 * cache tag, so node/profile writes invalidate it automatically.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCommunityNodes } from '@/lib/eventRepo';
import { normalizeNode } from '@/lib/graphUtils';
import { logger } from '@/lib/logger';
import { getSession, communityReadForbidden, directoryAccessForbidden } from '@/lib/auth';

type RouteContext = {
  params: Promise<{ communityId: string }>;
};

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { communityId } = await context.params;

    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (
      (await communityReadForbidden(session.userId, communityId)) ||
      (await directoryAccessForbidden(session.userId, communityId, session.email))
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const nodes = (await getCommunityNodes(communityId)).map(normalizeNode);

    return NextResponse.json(
      { nodes },
      {
        headers: {
          'Cache-Control': 'private, max-age=30, stale-while-revalidate=300',
        },
      }
    );
  } catch (error) {
    logger.error('api.community.directory.failed', { err: error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
