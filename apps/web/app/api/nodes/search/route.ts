import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { isSuperAdmin } from '@/lib/session';
import { directoryAccessForbidden } from '@/lib/auth';
import { handleApiError, requireApiSession } from '@/lib/api/route';

/**
 * Maps a CreateModal node type to the set of (lowercased) DB `type` values that
 * should match. New nodes are stored lowercase-canonical, but legacy data may be
 * capitalized or pluralized — we always compare LOWER(n.type) and accept the
 * common spellings.
 */
const TYPE_ALIASES: Record<string, string[]> = {
  person: ['person', 'people'],
  // Organisations have worn several retired spellings before settling on
  // `space`. All of them must match, or the duplicate check that guards the
  // note-first create surface silently finds nothing on legacy data.
  space: ['space', 'spaces', 'community', 'communities', 'group', 'groups', 'organization', 'organisation', 'org', 'company'],
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
 * The COMMUNITY half of organisation resolution: fuzzy-match the `communities`
 * table and hand back rows in the {@link SearchRow} shape the finder renders.
 *
 * Typing an org name searches two places — communities that actually run here
 * (this function) and organisations recorded in directories (the node search
 * below) — because both are things you might mean, and a real community is
 * always the better answer when it exists.
 *
 * `metadata.memberCount` is what marks a result as a live community in the
 * picker; `metadata.communityRef` is what the create surface sends back so the
 * new directory card binds to THAT community instead
 * of typing a second, unconnected record for the same organisation.
 *
 * Hidden: personal spaces (never an organisation), and private communities the
 * caller isn't an active member of.
 */
async function searchCommunities(q: string, session: { userId: string; email: string }) {
  const rows = await prisma.community.findMany({
    where: {
      name: { contains: q, mode: 'insensitive' },
      personalOwnerId: null,
      ...(isSuperAdmin(session.email)
        ? {}
        : {
            OR: [
              { visibility: 'public' },
              { userCommunities: { some: { userId: session.userId, status: 'active' } } },
            ],
          }),
    },
    select: {
      id: true, name: true, description: true, location: true, tags: true,
      imageUrl: true, memberCount: true,
    },
    orderBy: { name: 'asc' },
    take: 10,
  });

  return rows.map((c) => ({
    id: c.id,
    identity_id: null,
    name: c.name,
    subtitle: c.description,
    location: c.location,
    tags: c.tags ?? [],
    image_url: c.imageUrl,
    community_id: null,
    community_name: null,
    communities: [],
    metadata: {
      communityRef: c.id,
      memberCount: c.memberCount,
    } as Record<string, unknown>,
  }));
}

/**
 * GET /api/nodes/search?q=<query>&field=name|email&type=person|resource|event
 * Fuzzy-search nodes of a given type across all communities.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;

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

    // A community with an admins-only directory doesn't expose its nodes to
    // non-admin members through the picker either.
    if (communityId && (await directoryAccessForbidden(session.userId, communityId, session.email))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const isAny = type.toLowerCase() === 'any'; // 'any' = search every node kind (the link picker)
    const like = `%${q}%`;

    // Organisations resolve against communities as well as nodes — see
    // searchCommunities. Fetched up front so they can lead the results below.
    // The link picker's `type=any` is node-only and skips this.
    const communityMatches =
      type.toLowerCase() === 'space' ? await searchCommunities(q, session) : [];

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
    // Cross-community searches skip nodes in communities whose directory is
    // admins-only, unless the caller administers that community (super-admins
    // see everything).
    const privateDirectoryClause = isSuperAdmin(session.email)
      ? Prisma.empty
      : Prisma.sql` AND (c.id IS NULL OR c.feature_config->>'directoryPrivate' IS DISTINCT FROM 'true' OR EXISTS (
          -- Owns the community = holds a Person alias flagged owner (or the
          -- built-in "Owner") in communities.community_aliases.
          SELECT 1 FROM user_aliases ua
          WHERE ua.community_id = c.id AND ua.user_id = ${session.userId}
            AND (ua.alias_name = 'Owner' OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(c.community_aliases::jsonb) al
              WHERE al->>'name' = ua.alias_name
                AND lower(al->>'nodeType') = 'person'
                AND (al->>'owner')::boolean IS TRUE
            ))
        ))`;
    // A PRIVATE community is hidden from everyone who isn't in it — and that has
    // to cover its contents, not just its name. Its people, organisations and
    // resources are exactly what makes it worth hiding, so nothing inside one
    // reaches a cross-community search unless the caller is an active member.
    // (`directoryPrivate` above is a different, weaker setting: a PUBLIC
    // community whose directory is admins-only.) Null-community nodes have no
    // owner and pass.
    const privateCommunityClause = isSuperAdmin(session.email)
      ? Prisma.empty
      : Prisma.sql` AND (c.id IS NULL OR c.visibility IS DISTINCT FROM 'private' OR EXISTS (
          SELECT 1 FROM user_communities uc2
          WHERE uc2.community_id = c.id AND uc2.user_id = ${session.userId} AND uc2.status = 'active'
        ))`;

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
      WHERE ${matchExpr}${typeClause}${communityClause}${excludeClause}${personalClause}${privateDirectoryClause}${privateCommunityClause}
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

    const nodeResults = Array.from(groups.values()).map(({ rep, communities }) => ({
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

    // Communities lead, and swallow any directory record of the same name: if
    // Movac runs a community here, "Movac the card in someone's directory" is
    // the same organisation and offering both would just ask the user to pick
    // between two spellings of one answer.
    const claimedNames = new Set(communityMatches.map((c) => c.name.trim().toLowerCase()));
    const results = [
      ...communityMatches,
      ...nodeResults.filter((n) => !claimedNames.has(n.name.trim().toLowerCase())),
    ].slice(0, 10);

    return NextResponse.json({ results });
  } catch (err) {
    return handleApiError(err, 'api.nodes.search.failed');
  }
}
