// The directory finder behind GET /api/nodes/search: fuzzy-search nodes of a
// kind across every space the caller may see, plus — for organisations — the
// spaces that actually run here. The shaping is lib/directory/shared/search.ts.

import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { isSuperAdmin } from '@/lib/session'
import {
  collapseByIdentity,
  dbTypesFor,
  mergeSearchResults,
  type SearchResult,
  type SearchRow,
} from './shared/search'

export interface NodeSearchCaller {
  userId: string
  email: string
}

export interface NodeSearchQuery {
  /** At least two characters; the route refuses shorter. */
  q: string
  /** `email` matches person metadata; anything else matches the name. */
  field: string
  /** A picker kind (`person`, `space`, …) or `any` for every node kind. */
  type: string
  /** Scope to one space (the link picker). */
  spaceId: string | null
  /** Node ids never to return (the link picker's source node and neighbours). */
  excludeIds: readonly string[]
}

/**
 * The SPACE half of organisation resolution: fuzzy-match the `spaces` table
 * and hand back rows in the shape the finder renders.
 *
 * Typing an org name searches two places — spaces that actually run here
 * (this function) and organisations recorded in directories (the node search
 * below) — because both are things you might mean, and a real space is
 * always the better answer when it exists.
 *
 * `metadata.memberCount` is what marks a result as a live space in the
 * picker; `metadata.spaceRef` is what the create surface sends back so the
 * new directory card binds to THAT space instead of typing a second,
 * unconnected record for the same organisation.
 *
 * Hidden: personal spaces (never an organisation), and private spaces the
 * caller isn't an active member of.
 */
async function searchSpaces(q: string, caller: NodeSearchCaller): Promise<SearchResult[]> {
  const rows = await prisma.space.findMany({
    where: {
      name: { contains: q, mode: 'insensitive' },
      personalOwnerId: null,
      ...(isSuperAdmin(caller.email)
        ? {}
        : {
            OR: [
              { visibility: 'public' },
              { members: { some: { userId: caller.userId, status: 'active' } } },
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
  })

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
  }))
}

/** The finder's results for one query, already collapsed and merged. */
export async function searchNodes(query: NodeSearchQuery, caller: NodeSearchCaller): Promise<SearchResult[]> {
  const { q, field, spaceId, excludeIds } = query
  const type = query.type.toLowerCase()
  const isAny = type === 'any'
  const like = `%${q}%`

  // Organisations resolve against spaces as well as nodes — see
  // searchSpaces. Fetched up front so they can lead the results below.
  // The link picker's `type=any` is node-only and skips this.
  const spaceMatches = type === 'space' ? await searchSpaces(q, caller) : []

  // Email lives in person metadata only; for any other type fall back to name.
  const matchExpr =
    field === 'email' && type === 'person'
      ? Prisma.sql`LOWER(n.metadata->>'email') LIKE LOWER(${like})`
      : Prisma.sql`n.name ILIKE ${like}`

  const typeClause = isAny ? Prisma.empty : Prisma.sql` AND LOWER(n.type) IN (${Prisma.join(dbTypesFor(type))})`
  const spaceClause = spaceId ? Prisma.sql` AND n.space_id = ${spaceId}` : Prisma.empty
  const excludeClause = excludeIds.length ? Prisma.sql` AND n.id <> ALL(${[...excludeIds]}::text[])` : Prisma.empty
  // Never surface nodes that live in another user's personal space (private
  // `me:<userId>` spaces). Null-space nodes have no owner and pass.
  const personalClause = Prisma.sql` AND (c.personal_owner_id IS NULL OR c.personal_owner_id = ${caller.userId})`
  // Cross-space searches skip nodes in spaces whose directory is
  // admins-only, unless the caller administers that space (super-admins
  // see everything).
  const privateDirectoryClause = isSuperAdmin(caller.email)
    ? Prisma.empty
    : Prisma.sql` AND (c.id IS NULL OR c.feature_config->>'directoryPrivate' IS DISTINCT FROM 'true' OR EXISTS (
        -- Administers the space = holds a Person alias flagged admin (or the
        -- built-in "Admin") in spaces.aliases. Joined on the alias ID, which
        -- is what user_aliases stores — see lib/auth.ts#adminAliasIds, the
        -- non-SQL form of this same question.
        SELECT 1 FROM user_aliases ua
        WHERE ua.space_id = c.id AND ua.user_id = ${caller.userId}
          AND (ua.alias_id = 'admin' OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(c.aliases::jsonb) al
            WHERE al->>'id' = ua.alias_id
              AND lower(al->>'nodeType') = 'person'
              AND ((al->>'admin')::boolean IS TRUE OR (al->>'system')::boolean IS TRUE)
          ))
      ))`
  // A PRIVATE space is hidden from everyone who isn't in it — and that has
  // to cover its contents, not just its name. Its people, organisations and
  // resources are exactly what makes it worth hiding, so nothing inside one
  // reaches a cross-space search unless the caller is an active member.
  // (`directoryPrivate` above is a different, weaker setting: a PUBLIC
  // space whose directory is admins-only.) Null-space nodes have no
  // owner and pass.
  const privateSpaceClause = isSuperAdmin(caller.email)
    ? Prisma.empty
    : Prisma.sql` AND (c.id IS NULL OR c.visibility IS DISTINCT FROM 'private' OR EXISTS (
        SELECT 1 FROM space_members uc2
        WHERE uc2.space_id = c.id AND uc2.user_id = ${caller.userId} AND uc2.status = 'active'
      ))`

  // Over-fetch (LIMIT 30), then collapse down to the finder's ten.
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
  `

  return mergeSearchResults(spaceMatches, collapseByIdentity(rows))
}
