// Server-side only (imports prisma) — do not import from client components.
import prisma from '@/lib/prisma';
import { isSuperAdmin, type SessionPayload } from '@/lib/session';
import { adminCommunityIds } from '@/lib/auth';
import type { Community, CommunityAlias } from '@/lib/types';

/**
 * All communities visible to the given session, serialized to the exact shape
 * `GET /api/data/communities` returns (dates as ISO strings). Shared between
 * that route handler and the (auth) layout's server-side hydration so the
 * client provider state shape is identical either way.
 */
export async function listVisibleCommunities(session: SessionPayload): Promise<Community[]> {
  const superAdmin = isSuperAdmin(session.email);

  const data = await prisma.community.findMany({
    // Visibility rules (super-admins see everything):
    //  - Personal spaces (personalOwnerId set) are private to their owner.
    //  - Private communities (visibility 'private') are hidden from Discover /
    //    other users' lists unless the user is already an active member.
    //  - Public communities are visible to everyone.
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
                  userCommunities: {
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
      memberCount: true,
      createdAt: true,
      imageUrl: true,
      // The type vocabulary has to ride along: this list is what
      // CommunityContext resolves `currentCommunity` from, so without it every
      // client reads nodeTypes as undefined and falls back to the built-in
      // defaults — a community's own types and colours never reach the UI.
      nodeTypes: true,
      communityAliases: true,
      linkTypes: true,
      designConfig: true,
      featureConfig: true,
      visibility: true,
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
    memberCount: c.memberCount,
    dataFile: '',
    createdAt: c.createdAt.toISOString(),
    imageUrl: c.imageUrl ?? undefined,
    nodeTypes: (c.nodeTypes as unknown) as Community['nodeTypes'],
    communityAliases: (c.communityAliases as unknown as CommunityAlias[]) ?? [],
    linkTypes: (c.linkTypes as unknown) as Community['linkTypes'],
    designConfig: (c.designConfig as unknown as Community['designConfig']) ?? undefined,
    featureConfig: (c.featureConfig as unknown as Community['featureConfig']) ?? undefined,
    visibility: (c.visibility as 'public' | 'private') ?? 'public',
  }));
}

export interface UserCommunityMembership {
  id: string;
  name: string;
  description: string | null;
  country: string | null;
  location: string | null;
  tags: string[];
  memberCount: number;
  dataFile: string;
  createdAt: string;
  imageUrl: string | null;
  nodeTypes: unknown;
  communityAliases: unknown;
  linkTypes: unknown;
  designConfig: unknown;
  /** Whether the user holds an alias of this community that manages it. */
  isAdmin: boolean;
  joinedAt: string;
}

/**
 * The current user's community memberships, serialized to the exact shape
 * `GET /api/user/communities` returns. `isAdmin` is resolved in one query
 * across every membership (lib/auth.ts#adminCommunityIds); super-admins are
 * admins everywhere.
 */
export async function listUserCommunities(session: SessionPayload): Promise<UserCommunityMembership[]> {
  const memberships = await prisma.userCommunity.findMany({
    where: { userId: session.userId },
    select: {
      joinedAt: true,
      community: {
        select: {
          id: true,
          name: true,
          description: true,
          country: true,
          location: true,
          tags: true,
          memberCount: true,
          createdAt: true,
          imageUrl: true,
          nodeTypes: true,
          communityAliases: true,
          linkTypes: true,
          designConfig: true,
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  const adminIds = await adminCommunityIds(
    session.userId,
    memberships.map(m => m.community.id),
    session.email,
  );

  return memberships.map(m => ({
    id: m.community.id,
    name: m.community.name,
    description: m.community.description,
    country: m.community.country,
    location: m.community.location,
    tags: m.community.tags,
    memberCount: m.community.memberCount,
    dataFile: '',
    createdAt: m.community.createdAt.toISOString(),
    imageUrl: m.community.imageUrl,
    nodeTypes: m.community.nodeTypes,
    communityAliases: m.community.communityAliases,
    linkTypes: m.community.linkTypes,
    designConfig: m.community.designConfig,
    isAdmin: adminIds.has(m.community.id),
    joinedAt: m.joinedAt.toISOString(),
  }));
}
