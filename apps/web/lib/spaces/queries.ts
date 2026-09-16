// Server-side only (imports prisma) — do not import from client components.
import prisma from '@/lib/prisma';
import { isSuperAdmin, type SessionPayload } from '@/lib/session';
import { adminSpaceIds, adminSpaceIdsFrom } from '@/lib/auth';
import { installedToolsForSpaces } from '@/lib/tools/installs';
import type { Space, SpaceAlias } from '@/lib/types';
import { asDoor, listingOf, subspaceConfigOf } from '@/lib/spaces/subspaces';

const VISIBLE_SPACE_SELECT = {
  id: true,
  name: true,
  description: true,
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
  listing: true,
  houseDoor: true,
  worldDoor: true,
  flowContext: true,
  flowEvents: true,
  flowPeople: true,
  parentAdmins: true,
  subspaceConfig: true,
  timezone: true,
  // Derived, not stored: counting active memberships here cannot drift the
  // way a maintained column would.
  _count: { select: { members: { where: { status: 'active' } } } },
} as const;

/**
 * All spaces visible to the given session, serialized to the exact shape
 * `GET /api/data/spaces` returns (dates as ISO strings). Shared between
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
    select: VISIBLE_SPACE_SELECT,
    orderBy: { name: 'asc' },
  });

  // A private sub-space that hands its keys to the parent's admins is in the
  // list of whoever administers the parent, member or not: the server gates
  // already answer yes for them (lib/auth.ts#isAdmin), and a space one manages
  // but cannot open in the switcher is a door with no handle. Public ones and
  // ones they are in are in `data` already; this adds the rest.
  const reached = await parentAdministeredSpaces(session, data);
  data.push(...reached);

  // The installed Tools of every space in the list, in ONE query rather than
  // one per space: each install is a sidebar rail row and a `/t/<slug>` page, so
  // the client needs them wherever it resolves `currentSpace` from.
  const installedTools = await installedToolsForSpaces(data.map(c => c.id));

  // Prisma returns camelCase fields already via @map
  return data.map(c => ({
    id: c.id,
    name: c.name,
    description: c.description ?? '',
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
    listing: listingOf(c),
    houseDoor: asDoor(c.houseDoor, 'ask'),
    worldDoor: asDoor(c.worldDoor, 'open'),
    flowContext: c.flowContext,
    flowEvents: c.flowEvents,
    flowPeople: c.flowPeople,
    parentAdmins: c.parentAdmins,
    subspaceConfig: subspaceConfigOf(c.subspaceConfig),
    timezone: c.timezone ?? null,
    installedTools: installedTools.get(c.id) ?? [],
  }));
}

/**
 * The sub-spaces with `parentAdmins` on whose parent the caller administers
 * and which are not already in `listed` — the rows a parent's admin reaches
 * without a membership. Empty for a super-admin, who already sees everything.
 */
async function parentAdministeredSpaces<T extends { id: string; aliases: unknown; parentId?: string | null; parentAdmins?: boolean }>(
  session: SessionPayload,
  listed: T[],
): Promise<T[]> {
  if (isSuperAdmin(session.email)) return [];
  const adminIds = await adminSpaceIdsFrom(session.userId, listed, session.email);
  const parents = [...adminIds].filter((id) => !listed.find((s) => s.id === id)?.parentId);
  if (parents.length === 0) return [];
  const rows = await prisma.space.findMany({
    where: { parentAdmins: true, parentId: { in: parents }, id: { notIn: listed.map((s) => s.id) } },
    select: VISIBLE_SPACE_SELECT,
    orderBy: { name: 'asc' },
  });
  return rows as unknown as T[];
}

export interface SpaceMembership {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  tags: string[];
  memberCount: number;
  createdAt: string;
  imageUrl: string | null;
  nodeTypes: unknown;
  aliases: unknown;
  linkTypes: unknown;
  designConfig: unknown;
  /** Whether the user manages this space — directly, or through its parent (`parentAdmins`). */
  isAdmin: boolean;
  /** Whether they hold this space's OWN admin alias — the standing that can hand governance back on. */
  directAdmin: boolean;
  joinedAt: string;
  /** The space this one is a sub-space of, if any (docs/sub-spaces.md). */
  parentId: string | null;
}

const MEMBERSHIP_SPACE_SELECT = {
  id: true,
  name: true,
  description: true,
  location: true,
  tags: true,
  createdAt: true,
  imageUrl: true,
  nodeTypes: true,
  aliases: true,
  linkTypes: true,
  designConfig: true,
  parentId: true,
  parentAdmins: true,
  _count: { select: { members: { where: { status: 'active' as const } } } },
} as const;

/**
 * The current user's space memberships, serialized to the exact shape
 * `GET /api/user/spaces` returns. `isAdmin` is read off the alias lists
 * this query already loaded, in one `user_aliases` query across every
 * membership (lib/auth.ts#adminSpaceIdsFrom); super-admins are admins
 * everywhere.
 */
export async function listUserSpaces(session: SessionPayload): Promise<SpaceMembership[]> {
  const memberships = await prisma.spaceMember.findMany({
    where: { userId: session.userId },
    select: { joinedAt: true, space: { select: MEMBERSHIP_SPACE_SELECT } },
    orderBy: { joinedAt: 'asc' },
  });

  const [adminIds, directIds] = await Promise.all([
    adminSpaceIdsFrom(session.userId, memberships.map(m => m.space), session.email),
    adminSpaceIds(session.userId, memberships.map(m => m.space.id), session.email),
  ]);

  const toDto = (
    space: (typeof memberships)[number]['space'],
    joinedAt: Date,
  ): SpaceMembership => ({
    id: space.id,
    name: space.name,
    description: space.description,
    location: space.location,
    tags: space.tags,
    memberCount: space._count.members,
    createdAt: space.createdAt.toISOString(),
    imageUrl: space.imageUrl,
    nodeTypes: space.nodeTypes,
    aliases: space.aliases,
    linkTypes: space.linkTypes,
    designConfig: space.designConfig,
    isAdmin: adminIds.has(space.id),
    directAdmin: directIds.has(space.id),
    joinedAt: joinedAt.toISOString(),
    parentId: space.parentId,
  });

  return memberships.map(m => toDto(m.space, m.joinedAt));
}

/**
 * The thin form the (auth) layout hydrates the client with: which spaces the
 * caller belongs to and which they administer. `listVisibleSpaces` already
 * carries every one of these rows in full, so this reads only the two columns
 * that decide admin rather than the JSON blobs a second time.
 */
export async function listUserSpaceIds(
  session: SessionPayload,
): Promise<{ id: string; isAdmin: boolean; directAdmin: boolean }[]> {
  const memberships = await prisma.spaceMember.findMany({
    where: { userId: session.userId },
    select: { space: { select: { id: true, aliases: true, parentId: true, parentAdmins: true } } },
    orderBy: { joinedAt: 'asc' },
  });
  const [adminIds, directIds] = await Promise.all([
    adminSpaceIdsFrom(session.userId, memberships.map(m => m.space), session.email),
    adminSpaceIds(session.userId, memberships.map(m => m.space.id), session.email),
  ]);
  const out = memberships.map(m => ({ id: m.space.id, isAdmin: adminIds.has(m.space.id), directAdmin: directIds.has(m.space.id) }));
  // Plus the sub-spaces a parent's admin manages without being in
  // (parentAdministeredSpaces above): standing is the value, and for these
  // the key's presence is what lets the switcher open them.
  const reached = await parentAdministeredSpaces(session, memberships.map(m => m.space));
  for (const r of reached) out.push({ id: r.id, isAdmin: true, directAdmin: false });
  return out;
}
