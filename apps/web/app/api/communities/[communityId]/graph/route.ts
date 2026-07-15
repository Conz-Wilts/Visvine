/**
 * Community graph data API with event merging
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCommunityGraphData } from '@/lib/eventRepo';
import { normalizeNode, normalizeLink } from '@/lib/graphUtils';
import { requireApiSession, handleApiError, forbiddenResponse } from '@/lib/api/route';
import { communityReadForbidden, directoryAccessForbidden } from '@/lib/auth';

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

    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    if (
      (await communityReadForbidden(session.userId, communityId)) ||
      (await directoryAccessForbidden(session.userId, communityId, session.email))
    ) {
      return forbiddenResponse();
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
    return handleApiError(error, 'api.community.graph.failed');
  }
}
