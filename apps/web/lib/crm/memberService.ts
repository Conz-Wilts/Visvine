import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export interface MemberRow {
  user_id: string;
  email: string;
  is_active: boolean;
  joined_at: string;
  added_by: string | null;
  name: string;
  headline?: string;
  avatar_url?: string;
  bio?: string;
  location?: string;
  private_meta: Record<string, unknown>;
}

function flattenMember(row: {
  userId: string;
  joinedAt: Date;
  addedBy: string | null;
  privateMeta: Prisma.JsonValue;
  user: {
    email: string;
    isActive: boolean;
    name: string;
    image: string | null;
    publicMeta: Prisma.JsonValue;
  };
}): MemberRow {
  const meta = (row.user.publicMeta as Record<string, unknown>) ?? {};
  return {
    user_id: row.userId,
    email: row.user.email,
    is_active: row.user.isActive,
    joined_at: row.joinedAt.toISOString(),
    added_by: row.addedBy,
    name: (meta.name as string) || row.user.name,
    headline: meta.headline as string | undefined,
    avatar_url: (meta.avatar_url as string) || row.user.image || undefined,
    bio: meta.bio as string | undefined,
    location: meta.location as string | undefined,
    private_meta: (row.privateMeta as Record<string, unknown>) ?? {},
  };
}

export async function listCommunityMembers(
  communityId: string,
  params: {
    page: number;
    limit: number;
    search?: string;
    filter?: string;
    sort: string;
  }
): Promise<{ members: MemberRow[]; total: number }> {
  const { page, limit, search, filter, sort } = params;
  const [sortCol, sortDir] = sort.split(":");

  // Build user search conditions
  const userWhere: Prisma.UserWhereInput = search
    ? {
        OR: [
          { email: { contains: search, mode: "insensitive" } },
          { name: { contains: search, mode: "insensitive" } },
        ],
      }
    : {};

  // If filtering by a private_meta field, use raw SQL
  if (filter) {
    const colonIdx = filter.indexOf(":");
    const filterKey = filter.slice(0, colonIdx);
    const filterVal = filter.slice(colonIdx + 1);

    const orderClause =
      sortCol === "name"
        ? Prisma.sql`u.name`
        : sortCol === "joined_at"
          ? Prisma.sql`uc.joined_at`
          : Prisma.sql`u.name`;
    const dirClause =
      sortDir === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;

    const rows = await prisma.$queryRaw<
      Array<{
        user_id: string;
        email: string;
        is_active: boolean;
        joined_at: Date;
        added_by: string | null;
        private_meta: unknown;
        name: string;
        image: string | null;
        public_meta: unknown;
      }>
    >`
      SELECT uc.user_id, uc.joined_at, uc.added_by, uc.private_meta,
             u.email, u.is_active, u.name, u.image, u.public_meta
      FROM user_communities uc
      JOIN "user" u ON u.id = uc.user_id
      WHERE uc.community_id = ${communityId}
        AND uc.private_meta->>${filterKey} = ${filterVal}
        ${search ? Prisma.sql`AND (u.email ILIKE ${"%" + search + "%"} OR u.name ILIKE ${"%" + search + "%"})` : Prisma.sql``}
      ORDER BY ${orderClause} ${dirClause}
      LIMIT ${limit} OFFSET ${(page - 1) * limit}
    `;

    const countRows = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count
      FROM user_communities uc
      JOIN "user" u ON u.id = uc.user_id
      WHERE uc.community_id = ${communityId}
        AND uc.private_meta->>${filterKey} = ${filterVal}
    `;

    const members = rows.map((r) => {
      const meta = (r.public_meta as Record<string, unknown>) ?? {};
      return {
        user_id: r.user_id,
        email: r.email,
        is_active: r.is_active,
        joined_at: r.joined_at.toISOString(),
        added_by: r.added_by,
        name: (meta.name as string) || r.name,
        headline: meta.headline as string | undefined,
        avatar_url: (meta.avatar_url as string) || r.image || undefined,
        bio: meta.bio as string | undefined,
        location: meta.location as string | undefined,
        private_meta: (r.private_meta as Record<string, unknown>) ?? {},
      } satisfies MemberRow;
    });

    return { members, total: Number(countRows[0].count) };
  }

  // Standard Prisma query (no JSON filter)
  const orderBy: Prisma.UserCommunityOrderByWithRelationInput =
    sortCol === "joined_at"
      ? { joinedAt: sortDir === "desc" ? "desc" : "asc" }
      : { user: { name: sortDir === "desc" ? "desc" : "asc" } };

  const [rows, total] = await prisma.$transaction([
    prisma.userCommunity.findMany({
      where: { communityId, user: userWhere },
      include: {
        user: {
          select: {
            email: true,
            isActive: true,
            name: true,
            image: true,
            publicMeta: true,
          },
        },
      },
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.userCommunity.count({ where: { communityId, user: userWhere } }),
  ]);

  return { members: rows.map(flattenMember), total };
}

export async function getMember(
  communityId: string,
  userId: string
): Promise<MemberRow | null> {
  const row = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId, communityId } },
    include: {
      user: {
        select: {
          email: true,
          isActive: true,
          name: true,
          image: true,
          publicMeta: true,
        },
      },
    },
  });
  if (!row) return null;
  return flattenMember(row);
}
