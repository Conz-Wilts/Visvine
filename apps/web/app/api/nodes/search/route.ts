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
  space_id: string | null;
  identity_id: string | null;
  metadata: unknown;
  space_name: string | null;
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
 * The SPACE half of organisation resolution: fuzzy-match the `communities`
 * table and hand back rows in the {@link SearchRow} shape the finder renders.
 *
 * Typing an org name searches two places — spaces that actually run here
 * (this function) and organisations recorded in directories (the node search
 * below) — because both are things you might mean, and a real space is
 * always the better answer when it exists.
 *
 * `metadata.memberCount` is what marks a result as a live space in the
 * picker; `metadata.spaceRef` is what the create surface sends back so the
 * new directory card binds to THAT space instead
 * of typing a second, unconnected record for the same organisation.
 *
 * Hidden: personal spaces (never an organisation), and private spaces the
 * caller isn't an active member of.
 */
async function searchSpaces(q: string, session: { userId: string; email: string }) {
  const rows = await prisma.space.findMany({
    where: {
      name: { contains: q, mode: 'insensitive' },
      personalOwnerId: null,
      ...(isSuperAdmin(session.email)
        ? {}
        : {
            OR: [
              { visibility: 'public' },
              { members: { some: { userId: session.userId, status: 'active' } } },
            ],
          }),
    },
    select: {
      id: true, name: true, description: true, location: true, tags: true,
      imageUrl: true,
      _count: { select: { members: { where: { status: 'active' } } } },
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
    space_id: null,
    space_name: null,
    spaces: [],
    metadata: {
      spaceRef: c.id,
      memberCount: c._count.members,
    } as Record<string, unknown>,
  }));
}

/**
 * GET /api/nodes/search?q=<query>&field=name|email&type=person|resource|event
 * Fuzzy-search nodes of a given type across all spaces.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;

    const q = req.nextUrl.searchParams.get('q')?.trim();
    const field = req.nextUrl.searchParams.get('field') || 'name';
    const type = req.nextUrl.searchParams.get('type') || 'person';
    // Optional, backward-compatible. The link picker passes both: scope to one
    // space and exclude the source node + its existing neighbours so it can
    // only ever offer a valid new target.
    const spaceId = req.nextUrl.searchParams.get('space_id');
    const excludeIds = (req.nextUrl.searchParams.get('exclude_ids') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!q || q.length < 2) {
      return NextResponse.json({ results: [] });
    }

    // A space with an admins-only directory doesn't expose its nodes to
    // non-admin members through the picker either.
    if (spaceId && (await directoryAccessForbidden(session.userId, spaceId, session.email))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const isAny = type.toLowerCase() === 'any'; // 'any' = search every node kind (the link picker)
    const like = `%${q}%`;

    // Organisations resolve against spaces as well as nodes — see
    // searchSpaces. Fetched up front so they can lead the results below.
    // The link picker's `type=any` is node-only and skips this.
    const spaceMatches =
      type.toLowerCase() === 'space' ? await searchSpaces(q, session) : [];

    // Email lives in person metadata only; for any other type fall back to name.
    const matchExpr =
      field === 'email' && type.toLowerCase() === 'person'
        ? Prisma.sql`LOWER(n.metadata->>'email') LIKE LOWER(${like})`
        : Prisma.sql`n.name ILIKE ${like}`;

    const typeClause = isAny ? Prisma.empty : Prisma.sql` AND LOWER(n.type) IN (${Prisma.join(dbTypesFor(type))})`;
    const spaceClause = spaceId ? Prisma.sql` AND n.space_id = ${spaceId}` : Prisma.empty;
    const excludeClause = excludeIds.length ? Prisma.sql` AND n.id <> ALL(${excludeIds}::text[])` : Prisma.empty;
    // Never surface nodes that live in another user's personal space (private
    // `me:<userId>` spaces). Null-space nodes have no owner and pass.
    const personalClause = Prisma.sql` AND (c.personal_owner_id IS NULL OR c.personal_owner_id = ${session.userId})`;
    // Cross-space searches skip nodes in spaces whose directory is
    // admins-only, unless the caller administers that space (super-admins
    // see everything).
    const privateDirectoryClause = isSuperAdmin(session.email)
      ? Prisma.empty
      : Prisma.sql` AND (c.id IS NULL OR c.feature_config->>'directoryPrivate' IS DISTINCT FROM 'true' OR EXISTS (
          -- Owns the space = holds a Person alias flagged owner (or the
          -- built-in "Owner") in spaces.aliases.
          SELECT 1 FROM user_aliases ua
          WHERE ua.space_id = c.id AND ua.user_id = ${session.userId}
            AND (ua.alias_name = 'Owner' OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(c.aliases::jsonb) al
              WHERE al->>'name' = ua.alias_name
                AND lower(al->>'nodeType') = 'person'
                AND (al->>'owner')::boolean IS TRUE
            ))
        ))`;
    // A PRIVATE space is hidden from everyone who isn't in it — and that has
    // to cover its contents, not just its name. Its people, organisations and
    // resources are exactly what makes it worth hiding, so nothing inside one
    // reaches a cross-space search unless the caller is an active member.
    // (`directoryPrivate` above is a different, weaker setting: a PUBLIC
    // space whose directory is admins-only.) Null-space nodes have no
    // owner and pass.
    const privateSpaceClause = isSuperAdmin(session.email)
      ? Prisma.empty
      : Prisma.sql` AND (c.id IS NULL OR c.visibility IS DISTINCT FROM 'private' OR EXISTS (
          SELECT 1 FROM space_members uc2
          WHERE uc2.space_id = c.id AND uc2.user_id = ${session.userId} AND uc2.status = 'active'
        ))`;

    const rows = await prisma.$queryRaw<SearchRow[]>`
      SELECT
        n.id,
        n.name,
        n.subtitle,
        n.location,
        n.tags,
        n.image_url,
        n.space_id,
        n.identity_id,
        n.metadata,
        c.name AS space_name
      FROM nodes n
      LEFT JOIN spaces c ON c.id = n.space_id
      WHERE ${matchExpr}${typeClause}${spaceClause}${excludeClause}${personalClause}${privateDirectoryClause}${privateSpaceClause}
      ORDER BY n.name ASC
      LIMIT 30
    `;

    // Collapse to one entry per canonical identity so the finder shows e.g. "Craig
    // Piggott" once even when several spaces each have their own node for him.
    // Rows without an identity yet (legacy/unresolved) are kept distinct by node id.
    // We over-fetch (LIMIT 30) then group down to 10 distinct entries.
    const groups = new Map<string, { rep: SearchRow; spaces: Set<string> }>();
    for (const r of rows) {
      const key = r.identity_id ?? `node:${r.id}`;
      const existing = groups.get(key);
      if (r.space_name) {
        (existing?.spaces ?? new Set<string>()).add(r.space_name);
      }
      if (!existing) {
        const spaces = new Set<string>();
        if (r.space_name) spaces.add(r.space_name);
        groups.set(key, { rep: r, spaces });
      } else {
        if (r.space_name) existing.spaces.add(r.space_name);
        if (fieldScore(r) > fieldScore(existing.rep)) existing.rep = r;
      }
    }

    const nodeResults = Array.from(groups.values()).map(({ rep, spaces }) => ({
      id: rep.id,
      identity_id: rep.identity_id,
      name: rep.name,
      subtitle: rep.subtitle,
      location: rep.location,
      tags: rep.tags,
      image_url: rep.image_url,
      space_id: rep.space_id,
      space_name: rep.space_name,
      spaces: Array.from(spaces),
      metadata: rep.metadata as Record<string, unknown> | null,
    }));

    // Spaces lead, and swallow any directory record of the same name: if
    // Movac runs a space here, "Movac the card in someone's directory" is
    // the same organisation and offering both would just ask the user to pick
    // between two spellings of one answer.
    const claimedNames = new Set(spaceMatches.map((c) => c.name.trim().toLowerCase()));
    const results = [
      ...spaceMatches,
      ...nodeResults.filter((n) => !claimedNames.has(n.name.trim().toLowerCase())),
    ].slice(0, 10);

    return NextResponse.json({ results });
  } catch (err) {
    return handleApiError(err, 'api.nodes.search.failed');
  }
}
