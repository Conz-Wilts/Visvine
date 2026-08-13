// Server-side only (imports prisma) — do not import from client components.
import prisma from '@/lib/prisma';
import { isSuperAdmin, type SessionPayload } from '@/lib/session';
import { adminSpaceIds } from '@/lib/auth';
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
            // Public, or the caller is an active member of it.
            {
              OR: [
                { visibility: 'public' },
                { personalOwnerId: session.userId },
                {
                  members: {
                    some: { userId: session.userId, status: 'active' },
                  },
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
      // Derived, not stored: `memberCount` used to be a hand-maintained column
      // that four separate call sites incremented. Counting active memberships
      // here cannot drift.
      _count: { select: { members: { where: { status: 'active' } } } },
    },
    orderBy: { name: 'asc' },
  });

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
    visibility: (c.visibility as 'public' | 'private') ?? 'public',
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
  /** Whether the user holds an alias of this space that manages it. */
  isAdmin: boolean;
  joinedAt: string;
}

/**
 * The current user's space memberships, serialized to the exact shape
 * `GET /api/user/communities` returns. `isAdmin` is resolved in one query
 * across every membership (lib/auth.ts#adminSpaceIds); super-admins are
 * admins everywhere.
 */
export async function listUserSpaces(session: SessionPayload): Promise<SpaceMembership[]> {
  const memberships = await prisma.spaceMember.findMany({
    where: { userId: session.userId },
    select: {
      joinedAt: true,
      space: {
        select: {
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
          _count: { select: { members: { where: { status: 'active' } } } },
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  const adminIds = await adminSpaceIds(
    session.userId,
    memberships.map(m => m.space.id),
    session.email,
  );

  return memberships.map(m => ({
    id: m.space.id,
    name: m.space.name,
    description: m.space.description,
    country: m.space.country,
    location: m.space.location,
    tags: m.space.tags,
    memberCount: m.space._count.members,
    createdAt: m.space.createdAt.toISOString(),
    imageUrl: m.space.imageUrl,
    nodeTypes: m.space.nodeTypes,
    aliases: m.space.aliases,
    linkTypes: m.space.linkTypes,
    designConfig: m.space.designConfig,
    isAdmin: adminIds.has(m.space.id),
    joinedAt: m.joinedAt.toISOString(),
  }));
}
