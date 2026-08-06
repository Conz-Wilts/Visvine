/**
 * Node profile API — returns full node data with connection + community counts
 * GET /api/nodes/[nodeId]
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import prisma from '@/lib/prisma';
import { communityReadForbidden } from '@/lib/auth';
import { requireApiSession } from '@/lib/api/route';

type RouteContext = {
  params: Promise<{ nodeId: string }>;
};

const MAX_TAGS = 30;
const MAX_TAG_LEN = 40;

/** Normalise an incoming tag list: coerce to trimmed strings, drop blanks,
 *  cap length, dedupe case-insensitively (first spelling wins), cap count. */
function cleanTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().slice(0, MAX_TAG_LEN);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { nodeId } = await context.params;

  // Single parallel fetch: node, links, and all potentially connected nodes
  // Use a raw query to get links + connected node data in one shot
  const [node, linksWithNodes] = await Promise.all([
    prisma.node.findUnique({
      where: { id: nodeId },
      select: { id: true, type: true, name: true, subtitle: true, location: true, url: true, imageUrl: true, tags: true, metadata: true, alias: true, communityId: true, createdAt: true },
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

  // A node that lives in another user's personal space is private — treat it as
  // not-found rather than reveal its profile + connections.
  if (node.communityId && (await communityReadForbidden(session.userId, node.communityId))) {
    return NextResponse.json({ error: 'Node not found' }, { status: 404 });
  }

  // Real shared-community count: communities where both the viewer and the
  // profile's linked user are active members. Nodes without a linked user
  // exist in exactly their own community.
  let communityCount = 1;
  if (nodeId.startsWith('person:')) {
    const person = await prisma.person.findUnique({ where: { id: nodeId }, select: { userId: true } });
    if (person?.userId) {
      communityCount = Math.max(1, await prisma.userCommunity.count({
        where: {
          userId: person.userId,
          status: 'active',
          community: {
            personalOwnerId: null, // personal spaces aren't communities
            userCommunities: { some: { userId: session.userId, status: 'active' } },
          },
        },
      }));
    }
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
        alias: node.alias ?? undefined,
        community_id: node.communityId ?? undefined,
        createdAt: node.createdAt.toISOString(),
      },
      connectionCount: linksWithNodes.length,
      communityCount,
      connections: resolvedConnections,
    },
    {
      headers: {
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
      },
    }
  );
}

/** Node columns the property rows may write. Everything else is metadata, and
 *  identity/type/name stay off-limits here — retyping an entity is a four-sided
 *  migration (link FKs, the Person mirror, identity attachment, note frontmatter)
 *  and belongs to a dedicated endpoint, not an incidental field edit. */
const PATCHABLE_COLUMNS = {
  subtitle: 'subtitle',
  location: 'location',
  url: 'url',
  image_url: 'imageUrl',
} as const;

/**
 * PATCH /api/nodes/[nodeId] — update an entity's tags and property rows from its
 * context note. Body: { communityId, tags?, metadata?, subtitle?, location?,
 * url?, image_url? }. Gated on active membership of the node's own community
 * (the same audience that can read/write the community brain); these are shared
 * collaborative metadata, so any member with write access may edit them.
 *
 * `metadata` MERGES into the stored blob rather than replacing it — the property
 * rows only know the keys for the node's own type, and a replace would silently
 * drop everything else on the node (event form_schema, importer provenance…).
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { nodeId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const { communityId } = body as { communityId?: string };
  if (!communityId) {
    return NextResponse.json({ error: 'communityId is required' }, { status: 400 });
  }

  const columnKeys = Object.keys(PATCHABLE_COLUMNS).filter((k) => k in body);
  const hasTags = 'tags' in body;
  const hasMetadata = 'metadata' in body && body.metadata !== null && typeof body.metadata === 'object';
  if (!hasTags && !hasMetadata && columnKeys.length === 0) {
    return NextResponse.json(
      { error: 'One of tags, metadata, or a property column is required' },
      { status: 400 },
    );
  }
  const tags = hasTags ? cleanTags(body.tags) : null;

  const node = await prisma.node.findUnique({
    where: { id: nodeId },
    select: { communityId: true, metadata: true },
  });
  if (!node) return NextResponse.json({ error: 'Node not found' }, { status: 404 });

  // The note (and thus its tags) live in the node's own community brain; a
  // mismatched community would edit a misbound entity.
  if (node.communityId !== communityId) {
    return NextResponse.json({ error: 'Node not found' }, { status: 404 });
  }
  if (await communityReadForbidden(session.userId, communityId)) {
    return NextResponse.json({ error: 'Node not found' }, { status: 404 });
  }

  // Active membership of the community is the write gate.
  const membership = await prisma.userCommunity.findFirst({
    where: { userId: session.userId, communityId, status: 'active' },
    select: { id: true },
  });
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const data: Record<string, unknown> = {};
  if (tags !== null) data.tags = tags;
  for (const key of columnKeys) {
    const column = PATCHABLE_COLUMNS[key as keyof typeof PATCHABLE_COLUMNS];
    const value = body[key];
    // An empty string means "clear this row", which is a null column — storing
    // '' would make a blank field read as a real (empty) value downstream.
    data[column] = typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  }
  if (hasMetadata) {
    data.metadata = {
      ...((node.metadata as Record<string, unknown>) ?? {}),
      ...(body.metadata as Record<string, unknown>),
    };
  }

  // Update the context node; keep the Person mirror in sync so the person
  // profile's Skills section and avatar stay consistent with the same
  // underlying values.
  const personMirror: Record<string, unknown> = {};
  if (tags !== null) personMirror.tags = tags;
  if ('image_url' in body) personMirror.imageUrl = data.imageUrl;

  await prisma.$transaction([
    prisma.node.update({ where: { id: nodeId }, data }),
    ...(nodeId.startsWith('person:') && Object.keys(personMirror).length > 0
      ? [prisma.person.updateMany({ where: { id: nodeId }, data: personMirror })]
      : []),
  ]);

  revalidateTag('context-data-v2', { expire: 0 });
  return NextResponse.json({ tags: tags ?? undefined, ok: true });
}
