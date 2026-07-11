/**
 * Community graph data API with event merging
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCommunityGraphData } from '@/lib/eventRepo';
import { normalizeNode, normalizeLink } from '@/lib/graphUtils';
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

    const graphData = await getCommunityGraphData(communityId);
    const nodes = graphData.nodes.map(normalizeNode);
    const links = graphData.links.map(normalizeLink);

    return NextResponse.json(
      { nodes, links },
      {
        headers: {
          // Server-side freshness is governed by the 'graph-data-v2' cache tag
          // (revalidated on every node/link/event write). no-store only prevents
          // downstream HTTP/CDN caching of this response.
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    logger.error('api.community.graph.failed', { err: error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
