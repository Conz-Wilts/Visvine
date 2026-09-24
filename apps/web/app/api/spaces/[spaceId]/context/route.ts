/**
 * Space context data API with event merging
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSpaceContextData } from '@/lib/eventRepo';
import { normalizeNode, normalizeLink } from '@/lib/notes/context/normalize';
import { visibleGraph } from '@/lib/notes/context/featureVisibility';
import { visibleNodesFor } from '@/lib/notes/context/entityVisibility';
import { requireApiSession, handleApiError, forbiddenResponse } from '@/lib/api/route';
import { spaceMemberForbidden, directoryAccessForbidden, getFeatureConfig } from '@/lib/auth';

type RouteContext = {
  params: Promise<{ spaceId: string }>;
};

export const runtime = 'nodejs';

/** A link end is an id, or (in older cached payloads) the node itself. */
function endId(end: string | { id: string }): string {
  return typeof end === 'string' ? end : end.id;
}

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { spaceId } = await context.params;

    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    // Independent gates over the same request-memoized rows: one round trip.
    const [memberForbidden, featureForbidden] = await Promise.all([
      spaceMemberForbidden(session.userId, spaceId, session.email),
      directoryAccessForbidden(session.userId, spaceId, session.email),
    ]);
    if (memberForbidden || featureForbidden) {
      return forbiddenResponse();
    }

    const contextData = await getSpaceContextData(spaceId);
    // Types belonging to a switched-off tool leave the graph with their edges —
    // see lib/notes/context/featureVisibility.ts.
    const featureConfig = await getFeatureConfig(spaceId);
    const seen = new Set(
      (await visibleNodesFor(spaceId, session.userId, session.email, contextData.nodes)).map((node) => node.id),
    );
    const graph = visibleGraph(
      contextData.nodes.filter((node) => seen.has(node.id)).map(normalizeNode),
      contextData.links
        .filter((link) => seen.has(endId(link.source)) && seen.has(endId(link.target)))
        .map(normalizeLink),
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
