/**
 * Node profile API — returns full node data with connection + community counts
 * GET /api/nodes/[nodeId]
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';

type RouteContext = {
  params: Promise<{ nodeId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { nodeId } = await context.params;

  // Single parallel fetch: node, links, and all potentially connected nodes
  // Use a raw query to get links + connected node data in one shot
  const [node, linksWithNodes] = await Promise.all([
    prisma.node.findUnique({
      where: { id: nodeId },
      select: { id: true, type: true, name: true, subtitle: true, location: true, url: true, imageUrl: true, tags: true, metadata: true, communityId: true, createdAt: true },
    }),
    prisma.$queryRaw<Array<{
      source_id: string;
      target_id: string;
      relationship: string;
      since: string | null;
      connected_id: string;
      connected_name: string | null;
      connected_type: string | null;
      connected_image_url: string | null;
      connected_subtitle: string | null;
    }>>`
      SELECT
        l.source_id, l.target_id, l.relationship, l.since,
        n.id as connected_id, n.name as connected_name, n.type as connected_type,
        n.image_url as connected_image_url, n.subtitle as connected_subtitle
      FROM links l
      LEFT JOIN nodes n ON n.id = CASE
        WHEN l.source_id = ${nodeId} THEN l.target_id
        ELSE l.source_id
      END
      WHERE l.source_id = ${nodeId} OR l.target_id = ${nodeId}
    `,
  ]);

  if (!node) {
    return NextResponse.json({ error: 'Node not found' }, { status: 404 });
  }

  const resolvedConnections = linksWithNodes.map(l => ({
    id: l.connected_id,
    name: l.connected_name ?? l.connected_id,
    type: l.connected_type ?? 'person',
    image_url: l.connected_image_url ?? undefined,
    subtitle: l.connected_subtitle ?? undefined,
    relationship: l.relationship,
    since: l.since ?? undefined,
  }));

  return NextResponse.json(
    {
      node: {
        id: node.id,
        type: node.type,
        name: node.name,
        subtitle: node.subtitle,
        location: node.location,
        url: node.url,
        tags: node.tags,
        image_url: node.imageUrl ?? undefined,
        metadata: node.metadata as Record<string, unknown>,
        community_id: node.communityId ?? undefined,
        createdAt: node.createdAt.toISOString(),
      },
      connectionCount: linksWithNodes.length,
      communityCount: 1,
      connections: resolvedConnections,
    },
    {
      headers: {
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
      },
    }
  );
}
