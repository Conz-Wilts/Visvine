/**
 * Space context data API with event merging
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSpaceContextData } from '@/lib/eventRepo';
import { normalizeNode, normalizeLink } from '@/lib/notes/context/normalize';
import { visibleGraph } from '@/lib/notes/context/featureVisibility';
import { requireApiSession, handleApiError, forbiddenResponse } from '@/lib/api/route';
import { spaceMemberForbidden, directoryAccessForbidden, getFeatureConfig } from '@/lib/auth';

type RouteContext = {
  params: Promise<{ spaceId: string }>;
};

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { spaceId } = await context.params;

    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    if (
      (await spaceMemberForbidden(session.userId, spaceId, session.email)) ||
      (await directoryAccessForbidden(session.userId, spaceId, session.email))
    ) {
      return forbiddenResponse();
    }

    const contextData = await getSpaceContextData(spaceId);
    // Types belonging to a switched-off tool leave the graph with their edges —
    // see lib/notes/context/featureVisibility.ts.
    const featureConfig = await getFeatureConfig(spaceId);
    const graph = visibleGraph(
      contextData.nodes.map(normalizeNode),
      contextData.links.map(normalizeLink),
      featureConfig,
    );
    const { nodes, links } = graph;

    return NextResponse.json(
      { nodes, links },
      {
        headers: {
          // Server-side freshness is governed by the 'context-data-v2' cache tag
          // (revalidated on every node/link/event write). no-store only prevents
          // downstream HTTP/CDN caching of this response.
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    return handleApiError(error, 'api.space.context.failed');
  }
}
