// Server-side only (imports prisma) — do not import from client components.
import prisma from '@/lib/prisma';
import { isSuperAdmin, type SessionPayload } from '@/lib/session';
import { adminSpaceIds } from '@/lib/auth';
import { installedToolsForSpaces } from '@/lib/tools/installs';
import type { Space, SpaceAlias } from '@/lib/types';

/**
 * All spaces visible to the given session, serialized to the exact shape
 * `GET /api/data/communities` returns (dates as ISO strings). Shared between
 * that route handler and the (auth) layout's server-side hydration so the
 * client provider state shape is identical either way.
 */
export async function listVisibleSpaces(session: SessionPayload): Promise<Space[]> {
  const superAdmin = isSuperAdmin(session.email);

  const data = await prisma.space.findMany({
    // Visibility rules (super-admins see everything):
    //  - Personal spaces (personalOwnerId set) are private to their owner.
    //  - Private spaces (visibility 'private') are hidden from Discover /
    //    other users' lists unless the user is already an active member.
    //  - Public spaces are visible to everyone.
    where: superAdmin
      ? undefined
      : {
          AND: [
            // Not someone else's personal space.
            {
              OR: [
                { personalOwnerId: null },
                { personalOwnerId: session.userId },
              ],
            },
            // Public, or the caller is an active member of it, or it inherits
            // from a parent the caller is an active member of (docs/sub-spaces.md).
            {
              OR: [
                { visibility: 'public' },
                { personalOwnerId: session.userId },
                {
                  members: {
                    some: { userId: session.userId, status: 'active' },
                  },
                },
                {
                  visibility: 'inherit',
                  parent: { members: { some: { userId: session.userId, status: 'active' } } },
                },
              ],
            },
          ],
        },
    select: {
      id: true,
      name: true,
      description: true,
      country: true,
      location: true,
      tags: true,
      createdAt: true,
      imageUrl: true,
      // The type vocabulary has to ride along: this list is what
      // SpaceContext resolves `currentSpace` from, so without it every
      // client reads nodeTypes as undefined and falls back to the built-in
      // defaults — a space's own types and colours never reach the UI.
      nodeTypes: true,
      aliases: true,
      linkTypes: true,
      designConfig: true,
      featureConfig: true,
      visibility: true,
      parentId: true,
      timezone: true,
      // Derived, not stored: counting active memberships here cannot drift the
      // way a maintained column would.
      _count: { select: { members: { where: { status: 'active' } } } },
    },
    orderBy: { name: 'asc' },
  });

  // The installed Tools of every space in the list, in ONE query rather than
  // one per space: each install is a sidebar rail row and a `/t/<slug>` page, so
  // the client needs them wherever it resolves `currentSpace` from.
  const installedTools = await installedToolsForSpaces(data.map(c => c.id));

  // Prisma returns camelCase fields already via @map
  return data.map(c => ({
    id: c.id,
    name: c.name,
    description: c.description ?? '',
    country: c.country ?? undefined,
    location: c.location ?? undefined,
    tags: c.tags ?? [],
    memberCount: c._count.members,
    createdAt: c.createdAt.toISOString(),
    imageUrl: c.imageUrl ?? undefined,
    nodeTypes: (c.nodeTypes as unknown) as Space['nodeTypes'],
    aliases: (c.aliases as unknown as SpaceAlias[]) ?? [],
    linkTypes: (c.linkTypes as unknown) as Space['linkTypes'],
    designConfig: (c.designConfig as unknown as Space['designConfig']) ?? undefined,
    featureConfig: (c.featureConfig as unknown as Space['featureConfig']) ?? undefined,
    visibility: (c.visibility as Space['visibility']) ?? 'public',
    parentId: c.parentId,
    timezone: c.timezone ?? null,
    installedTools: installedTools.get(c.id) ?? [],
  }));
}

export interface SpaceMembership {
  id: string;
  name: string;
  description: string | null;
  country: string | null;
  location: string | null;
  tags: string[];
  memberCount: number;
  createdAt: string;
  imageUrl: string | null;
  nodeTypes: unknown;
  aliases: unknown;
  linkTypes: unknown;
  designConfig: unknown;
  parentId: string | null;
  /** Whether the user holds an alias of this space that manages it. */
  isAdmin: boolean;
  /**
   * `member` = they hold a membership row; `inherit` = the space is open to them
   * as a member of its parent (docs/sub-spaces.md). Both count as "a space you
   * are in" for the switcher.
   */
  via: 'member' | 'inherit';
  joinedAt: string;
}

const MEMBERSHIP_SPACE_SELECT = {
  id: true,
  name: true,
  description: true,
  country: true,
  location: true,
  tags: true,
  createdAt: true,
  imageUrl: true,
  nodeTypes: true,
  aliases: true,
  linkTypes: true,
  designConfig: true,
  parentId: true,
  _count: { select: { members: { where: { status: 'active' as const } } } },
} as const;

/**
 * The current user's space memberships, serialized to the exact shape
 * `GET /api/user/communities` returns. `isAdmin` is resolved in one query
 * across every membership (lib/auth.ts#adminSpaceIds); super-admins are
 * admins everywhere.
 */
export async function listUserSpaces(session: SessionPayload): Promise<SpaceMembership[]> {
  const memberships = await prisma.spaceMember.findMany({
    where: { userId: session.userId },
    select: { joinedAt: true, space: { select: MEMBERSHIP_SPACE_SELECT } },
    orderBy: { joinedAt: 'asc' },
  });

  // Spaces reached through a parent: inheriting children of every space the
  // user is an active member of. Not membership rows — a membership of a child
  // is something you are given — but they belong in the switcher all the same.
  const activeIds = memberships.filter(m => m.space).map(m => m.space.id);
  const inherited = activeIds.length
    ? await prisma.space.findMany({
        where: {
          visibility: 'inherit',
          parentId: { in: activeIds },
          NOT: { members: { some: { userId: session.userId } } },
        },
        select: { ...MEMBERSHIP_SPACE_SELECT, createdAt: true },
        orderBy: { name: 'asc' },
      })
    : [];

  const allIds = [...memberships.map(m => m.space.id), ...inherited.map(s => s.id)];
  const adminIds = await adminSpaceIds(session.userId, allIds, session.email);

  const toDto = (
    space: (typeof memberships)[number]['space'],
    via: 'member' | 'inherit',
    joinedAt: Date,
  ): SpaceMembership => ({
    id: space.id,
    name: space.name,
    description: space.description,
    country: space.country,
    location: space.location,
    tags: space.tags,
    memberCount: space._count.members,
    createdAt: space.createdAt.toISOString(),
    imageUrl: space.imageUrl,
    nodeTypes: space.nodeTypes,
    aliases: space.aliases,
    linkTypes: space.linkTypes,
    designConfig: space.designConfig,
    parentId: space.parentId,
    isAdmin: adminIds.has(space.id),
    via,
    joinedAt: joinedAt.toISOString(),
  });

  return [
    ...memberships.map(m => toDto(m.space, 'member', m.joinedAt)),
    ...inherited.map(s => toDto(s, 'inherit', s.createdAt)),
  ];
}
