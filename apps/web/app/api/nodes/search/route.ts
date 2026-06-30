import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { logger } from '@/lib/logger';

/**
 * Maps a CreateModal node type to the set of (lowercased) DB `type` values that
 * should match. New nodes are stored lowercase-canonical, but legacy data may be
 * capitalized or pluralized — we always compare LOWER(n.type) and accept the
 * common spellings.
 */
const TYPE_ALIASES: Record<string, string[]> = {
  person: ['person', 'people'],
  resource: ['resource', 'resources'],
  event: ['event', 'events'],
};

function dbTypesFor(type: string): string[] {
  const key = type.toLowerCase();
  return TYPE_ALIASES[key] ?? [key];
}

interface SearchRow {
  id: string;
  name: string;
  subtitle: string | null;
  location: string | null;
  tags: string[];
  image_url: string | null;
  community_id: string | null;
  identity_id: string | null;
  metadata: unknown;
  community_name: string | null;
}

/** How many fields a row has filled — used to pick the best representative per identity. */
function fieldScore(r: SearchRow): number {
  let n = 0;
  if (r.subtitle) n++;
  if (r.location) n++;
  if (r.tags?.length) n++;
  if (r.image_url) n++;
  if ((r.metadata as Record<string, unknown> | null)?.email) n++;
  return n;
}

/**
 * GET /api/nodes/search?q=<query>&field=name|email&type=person|resource|event
 * Fuzzy-search nodes of a given type across all communities.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const q = req.nextUrl.searchParams.get('q')?.trim();
    const field = req.nextUrl.searchParams.get('field') || 'name';
    const type = req.nextUrl.searchParams.get('type') || 'person';
    // Optional, backward-compatible. The link picker passes both: scope to one
    // community and exclude the source node + its existing neighbours so it can
    // only ever offer a valid new target.
    const communityId = req.nextUrl.searchParams.get('community_id');
    const excludeIds = (req.nextUrl.searchParams.get('exclude_ids') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!q || q.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const isAny = type.toLowerCase() === 'any'; // 'any' = search every node kind (the link picker)
    const like = `%${q}%`;

    // Email lives in person metadata only; for any other type fall back to name.
    const matchExpr =
      field === 'email' && type.toLowerCase() === 'person'
        ? Prisma.sql`LOWER(n.metadata->>'email') LIKE LOWER(${like})`
        : Prisma.sql`n.name ILIKE ${like}`;

    const typeClause = isAny ? Prisma.empty : Prisma.sql` AND LOWER(n.type) IN (${Prisma.join(dbTypesFor(type))})`;
    const communityClause = communityId ? Prisma.sql` AND n.community_id = ${communityId}` : Prisma.empty;
    const excludeClause = excludeIds.length ? Prisma.sql` AND n.id <> ALL(${excludeIds}::text[])` : Prisma.empty;
    // Never surface nodes that live in another user's personal space (private
    // `me:<userId>` communities). Null-community nodes have no owner and pass.
    const personalClause = Prisma.sql` AND (c.personal_owner_id IS NULL OR c.personal_owner_id = ${session.userId})`;

    const rows = await prisma.$queryRaw<SearchRow[]>`
      SELECT
        n.id,
        n.name,
        n.subtitle,
        n.location,
        n.tags,
        n.image_url,
        n.community_id,
        n.identity_id,
        n.metadata,
        c.name AS community_name
      FROM nodes n
      LEFT JOIN communities c ON c.id = n.community_id
      WHERE ${matchExpr}${typeClause}${communityClause}${excludeClause}${personalClause}
      ORDER BY n.name ASC
      LIMIT 30
    `;

    // Collapse to one entry per canonical identity so the finder shows e.g. "Craig
    // Piggott" once even when several communities each have their own node for him.
    // Rows without an identity yet (legacy/unresolved) are kept distinct by node id.
    // We over-fetch (LIMIT 30) then group down to 10 distinct entries.
    const groups = new Map<string, { rep: SearchRow; communities: Set<string> }>();
    for (const r of rows) {
      const key = r.identity_id ?? `node:${r.id}`;
      const existing = groups.get(key);
      if (r.community_name) {
        (existing?.communities ?? new Set<string>()).add(r.community_name);
      }
      if (!existing) {
        const communities = new Set<string>();
        if (r.community_name) communities.add(r.community_name);
        groups.set(key, { rep: r, communities });
      } else {
        if (r.community_name) existing.communities.add(r.community_name);
        if (fieldScore(r) > fieldScore(existing.rep)) existing.rep = r;
      }
    }

    const results = Array.from(groups.values())
      .slice(0, 10)
      .map(({ rep, communities }) => ({
        id: rep.id,
        identity_id: rep.identity_id,
        name: rep.name,
        subtitle: rep.subtitle,
        location: rep.location,
        tags: rep.tags,
        image_url: rep.image_url,
        community_id: rep.community_id,
        community_name: rep.community_name,
        communities: Array.from(communities),
        metadata: rep.metadata as Record<string, unknown> | null,
      }));

    return NextResponse.json({ results });
  } catch (err) {
    logger.error('api.nodes.search.failed', { err });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
