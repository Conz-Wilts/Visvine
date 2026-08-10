import prisma from '@/lib/prisma';
import { getSession, isSuperAdmin, type SessionPayload } from '@/lib/session';
import { isForeignPersonalSpace } from '@/lib/communities/personalSpace';
import { isDirectoryPrivate } from '@/lib/featureAccess';
import { personAliases, type CommunityAlias } from '@/lib/types/context';
import type { CommunityFeatureConfig } from '@/lib/types';

/**
 * The names of a community's Person aliases whose holders own (manage) it.
 * Aliases live in `Community.communityAliases`, created on the Types page — the
 * same list that colours a person's chip in the directory.
 */
async function owningAliasNames(communityIds: string[]): Promise<Map<string, Set<string>>> {
  const communities = await prisma.community.findMany({
    where: { id: { in: communityIds } },
    select: { id: true, communityAliases: true },
  });
  const out = new Map<string, Set<string>>();
  for (const c of communities) {
    const owning = personAliases((c.communityAliases ?? []) as unknown as CommunityAlias[])
      .filter((a) => a.owner === true || a.system === true)
      .map((a) => a.name);
    out.set(c.id, new Set(owning));
  }
  return out;
}

/**
 * Whether a user manages a community: they hold at least one of its Person
 * aliases marked `owner` (always including the built-in Owner alias). That is
 * the only definition of admin in the app — there is no role column.
 * Super-admins (env `SUPER_ADMIN_EMAILS`) bypass the DB lookup.
 */
export async function isAdmin(
  userId: string,
  communityId: string,
  email?: string | null,
): Promise<boolean> {
  if (isSuperAdmin(email)) return true;
  const owning = (await owningAliasNames([communityId])).get(communityId);
  if (!owning || owning.size === 0) return false;
  const held = await prisma.userAlias.findFirst({
    where: { userId, communityId, aliasName: { in: [...owning] } },
    select: { id: true },
  });
  return held !== null;
}

/**
 * The same question for many communities at once, for the session/community
 * list endpoints that would otherwise fire one isAdmin query per membership.
 * Super-admins get every id back.
 */
export async function adminCommunityIds(
  userId: string,
  communityIds: string[],
  email?: string | null,
): Promise<Set<string>> {
  if (isSuperAdmin(email)) return new Set(communityIds);
  if (communityIds.length === 0) return new Set();
  const owning = await owningAliasNames(communityIds);
  const held = await prisma.userAlias.findMany({
    where: { userId, communityId: { in: communityIds } },
    select: { communityId: true, aliasName: true },
  });
  const out = new Set<string>();
  for (const h of held) {
    if (owning.get(h.communityId)?.has(h.aliasName)) out.add(h.communityId);
  }
  return out;
}

// Re-exported so routes can import the personal-space predicate + DB guard from
// one auth module. The pure predicate lives in lib/communities/personalSpace.ts.
export { isForeignPersonalSpace };

/**
 * DB-backed guard for community-scoped reads/joins: looks up the community and
 * returns true when it's another user's personal space (so the route should 403
 * / 404). Unknown communities return false — the caller's own not-found/empty
 * handling takes over. Use this on every endpoint that returns or mutates
 * community-scoped data by `communityId`, since a personal space's directory and
 * context would otherwise be readable by any authenticated user.
 */
export async function communityReadForbidden(
  userId: string,
  communityId: string,
): Promise<boolean> {
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { personalOwnerId: true },
  });
  return community ? isForeignPersonalSpace(community.personalOwnerId, userId) : false;
}

/**
 * DB-backed guard for directory/context reads: returns true when the community's
 * directory is marked admins-only (`featureConfig.directoryPrivate`) and the
 * caller is not an admin of it. Unknown communities return false — the caller's
 * own not-found/empty handling takes over.
 */
export async function directoryAccessForbidden(
  userId: string,
  communityId: string,
  email?: string | null,
): Promise<boolean> {
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { featureConfig: true },
  });
  if (!community) return false;
  const config = (community.featureConfig ?? {}) as CommunityFeatureConfig;
  if (!isDirectoryPrivate(config)) return false;
  return !(await isAdmin(userId, communityId, email));
}

/**
 * A community's feature config, or null when it has none (or doesn't exist).
 * The directory and context routes read it to hide the node types belonging to
 * a switched-off tool — see lib/notes/context/featureVisibility.ts.
 */
export async function getFeatureConfig(
  communityId: string,
): Promise<CommunityFeatureConfig | null> {
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { featureConfig: true },
  });
  return (community?.featureConfig as CommunityFeatureConfig | null) ?? null;
}

/**
 * Session + community-admin gate, as a value (not a Response). Returns the
 * session payload if the caller is a community admin (or super admin),
 * otherwise null — mirrors the gate several admin routes used to inline.
 *
 *   const session = await getAdminSession(communityId);
 *   if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 */
export async function getAdminSession(communityId: string): Promise<SessionPayload | null> {
  const session = await getSession();
  if (!session) return null;
  return (await isAdmin(session.userId, communityId, session.email)) ? session : null;
}

/**
 * Returns the current session or null. Convenience re-export so routes
 * only need to import from one auth module.
 */
export { getSession, isSuperAdmin, type SessionPayload } from '@/lib/session';
