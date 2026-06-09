/**
 * "You both know X" — the people a requester and a target are both directly
 * connected to. These are the candidate introducers for a warm intro.
 *
 * Mirrors the adjacency query in app/api/nodes/[nodeId]/route.ts: a self-join on
 * `links` (which are undirected in practice — either source/target order counts).
 */

import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import type { MutualConnection } from './types';

interface MutualRow {
  id: string;
  name: string | null;
  type: string | null;
  subtitle: string | null;
  image_url: string | null;
  rel_requester: string | null;
  since_requester: string | null;
  rel_target: string | null;
}

export async function getMutuals(
  requesterNodeId: string,
  targetNodeId: string,
  communityId?: string,
): Promise<MutualConnection[]> {
  if (!requesterNodeId || !targetNodeId || requesterNodeId === targetNodeId) return [];

  // Scope by the *relationships'* community (a warm intro is "you both know X in
  // this community"), not the mutual's own node.community_id — which can differ.
  const communityFilter = communityId
    ? Prisma.sql`AND lr.community_id = ${communityId} AND lt.community_id = ${communityId}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<MutualRow[]>(Prisma.sql`
    SELECT DISTINCT ON (n.id)
      n.id, n.name, n.type, n.subtitle, n.image_url,
      lr.relationship AS rel_requester, lr.since AS since_requester,
      lt.relationship AS rel_target
    FROM nodes n
    JOIN links lr ON (lr.source_id = n.id AND lr.target_id = ${requesterNodeId})
                  OR (lr.target_id = n.id AND lr.source_id = ${requesterNodeId})
    JOIN links lt ON (lt.source_id = n.id AND lt.target_id = ${targetNodeId})
                  OR (lt.target_id = n.id AND lt.source_id = ${targetNodeId})
    WHERE n.id <> ${requesterNodeId}
      AND n.id <> ${targetNodeId}
      AND (n.type = 'People' OR n.id LIKE 'person:%')
      ${communityFilter}
    ORDER BY n.id
  `);

  return rows.map((r) => ({
    id: r.id,
    name: r.name ?? r.id,
    type: r.type ?? 'People',
    subtitle: r.subtitle,
    imageUrl: r.image_url,
    sharedSince: r.since_requester,
    relationshipToRequester: r.rel_requester ?? 'connected',
    relationshipToTarget: r.rel_target ?? 'connected',
  }));
}
