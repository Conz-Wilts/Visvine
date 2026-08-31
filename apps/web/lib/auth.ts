import prisma from '@/lib/prisma';
import { getSession, isSuperAdmin, type SessionPayload } from '@/lib/session';
import { isForeignPersonalSpace } from '@/lib/spaces/personalSpaceAccess';
import { isGlobalSpace } from '@/lib/spaces/globalSpace';
import { canAccessFeature } from '@/lib/featureAccess';
import { personAliases, type SpaceAlias } from '@/lib/types/context';
import type { SpaceFeatureConfig } from '@/lib/types';

/**
 * The ids of a space's Person aliases whose holders own (manage) it.
 * Aliases live in `Space.aliases`, created on the Types page — the
 * same list that colours a person's chip in the directory.
 *
 * Ids, not names: this is the query that decides admin, and matching on a name
 * meant a rename had to rewrite `user_aliases` in the same breath or everybody
 * holding the alias lost their access in between.
 */
async function adminAliasIds(spaceIds: string[]): Promise<Map<string, Set<string>>> {
  const spaces = await prisma.space.findMany({
    where: { id: { in: spaceIds } },
    select: { id: true, aliases: true },
  });
  const out = new Map<string, Set<string>>();
  for (const c of spaces) {
    const owning = personAliases((c.aliases ?? []) as unknown as SpaceAlias[])
      .filter((a) => a.admin === true || a.system === true)
      .map((a) => a.id)
      .filter((id): id is string => Boolean(id));
    out.set(c.id, new Set(owning));
  }
  return out;
}

/**
 * Whether a user manages a space: they hold at least one of its Person
 * aliases marked `admin` (always including the built-in Admin alias). That is
 * the only definition of admin in the app — there is no role column.
 * Super-admins (env `SUPER_ADMIN_EMAILS`) bypass the DB lookup.
 */
export async function isAdmin(
  userId: string,
  spaceId: string,
  email?: string | null,
): Promise<boolean> {
  if (isSuperAdmin(email)) return true;
  return (await adminSpaceIds(userId, [spaceId])).has(spaceId);
}

/**
 * Which of `spaceIds` the user holds an admin alias in directly — before
 * ancestry is applied.
 */
async function directlyAdministered(userId: string, spaceIds: string[]): Promise<Set<string>> {
  if (spaceIds.length === 0) return new Set();
  const [owning, held] = await Promise.all([
    adminAliasIds(spaceIds),
    prisma.userAlias.findMany({
      where: { userId, spaceId: { in: spaceIds } },
      select: { spaceId: true, aliasId: true },
    }),
  ]);
  const out = new Set<string>();
  for (const h of held) {
    if (owning.get(h.spaceId)?.has(h.aliasId)) out.add(h.spaceId);
  }
  return out;
}

/**
 * The same question for many spaces at once, for the session/space
 * list endpoints that would otherwise fire one isAdmin query per membership.
 * Super-admins get every id back.
 */
export async function adminSpaceIds(
  userId: string,
  spaceIds: string[],
  email?: string | null,
): Promise<Set<string>> {
  if (isSuperAdmin(email)) return new Set(spaceIds);
  if (spaceIds.length === 0) return new Set();
  return directlyAdministered(userId, spaceIds);
}

// Re-exported so routes can import the personal-space predicate + DB guard from
// one auth module. The pure predicate lives in lib/spaces/personalSpace.ts.
export { isForeignPersonalSpace };

/**
 * DB-backed guard for space-scoped reads/joins: looks up the space and
 * returns true when it's another user's personal space (so the route should 403
 * / 404). Unknown spaces return false — the caller's own not-found/empty
 * handling takes over. Use this on every endpoint that returns or mutates
 * space-scoped data by `spaceId`, since a personal space's directory and
 * context would otherwise be readable by any authenticated user.
 */
export async function spaceReadForbidden(
  userId: string,
  spaceId: string,
): Promise<boolean> {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { personalOwnerId: true },
  });
  return space ? isForeignPersonalSpace(space.personalOwnerId, userId) : false;
}

/** Whether the user holds an active membership row in `spaceId`. */
async function isActiveMember(userId: string, spaceId: string): Promise<boolean> {
  const membership = await prisma.spaceMember.findFirst({
    where: { userId, spaceId, status: 'active' },
    select: { id: true },
  });
  return membership !== null;
}

/**
 * Membership-enforcing gate for space-scoped reads/writes: returns true when
 * this caller has no business touching `spaceId` at all — it's another
 * user's personal space, or it's a normal space they neither actively
 * belong to nor administer. This is the stronger superset of
 * `spaceReadForbidden` (which only guarded personal spaces and let any
 * signed-in user read a space they don't belong to). Use it on any endpoint
 * that returns or mutates a space's records. Unknown spaces return
 * false so the caller's own not-found/empty handling takes over.
 */
export async function spaceMemberForbidden(
  userId: string,
  spaceId: string,
  email?: string | null,
): Promise<boolean> {
  const [space, activeMember] = await Promise.all([
    prisma.space.findUnique({
      where: { id: spaceId },
      select: { personalOwnerId: true },
    }),
    isActiveMember(userId, spaceId),
  ]);
  if (!space) return false;
  // The global space has no members: every signed-in user reads it, and what
  // may be written there is decided per path by lib/notes/contextService.ts.
  if (isGlobalSpace(spaceId)) return false;
  // Personal space: only its admin may read or write it.
  if (space.personalOwnerId != null) return space.personalOwnerId !== userId;
  // Normal space: an active member passes, and so does an admin of it.
  if (activeMember) return false;
  return !(await isAdmin(userId, spaceId, email));
}

/**
 * Reads: is this space open to the caller at all — member or admin — as one
 * boolean, for the notes resolver.
 */
export async function canReadSpace(userId: string, spaceId: string, email?: string | null): Promise<boolean> {
  return !(await spaceMemberForbidden(userId, spaceId, email));
}

/**
 * DB-backed guard for a tool's API routes: returns true when the space has
 * put `featureKey` out of this caller's reach — either the tool is removed
 * outright or it's marked admins-only and they aren't an admin. Unknown
 * spaces return false — the caller's own not-found/empty handling takes
 * over.
 *
 * The sidebar and the client route guard already apply `canAccessFeature`; this
 * is the same predicate on the server, so a member who knows the URL is stopped
 * by the API and not only by the UI that hid the link.
 */
export async function featureAccessForbidden(
  userId: string,
  spaceId: string,
  featureKey: string,
  email?: string | null,
): Promise<boolean> {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { featureConfig: true },
  });
  if (!space) return false;
  const config = (space.featureConfig ?? {}) as SpaceFeatureConfig;
  // Cheap path first: when the feature is open to members there's nothing to
  // check, so the common case never costs an admin lookup.
  if (canAccessFeature(config, featureKey, false)) return false;
  return !(await isAdmin(userId, spaceId, email));
}

/**
 * The directory's form of the above. `adminOnlyFeatureKeys` folds the legacy
 * `featureConfig.directoryPrivate` flag in under the `directory` key, so old
 * configs keep working — including the raw-SQL guard in the node-search route,
 * which still reads that flag directly.
 */
export async function directoryAccessForbidden(
  userId: string,
  spaceId: string,
  email?: string | null,
): Promise<boolean> {
  return featureAccessForbidden(userId, spaceId, 'directory', email);
}

/**
 * A space's feature config, or null when it has none (or doesn't exist).
 * The directory and context routes read it to hide the node types belonging to
 * a switched-off tool — see lib/notes/context/featureVisibility.ts.
 */
export async function getFeatureConfig(
  spaceId: string,
): Promise<SpaceFeatureConfig | null> {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { featureConfig: true },
  });
  return (space?.featureConfig as SpaceFeatureConfig | null) ?? null;
}

/**
 * Session + space-admin gate, as a value (not a Response). Returns the
 * session payload if the caller is a space admin (or super admin),
 * otherwise null.
 *
 *   const session = await getAdminSession(spaceId);
 *   if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 */
export async function getAdminSession(spaceId: string): Promise<SessionPayload | null> {
  const session = await getSession();
  if (!session) return null;
  return (await isAdmin(session.userId, spaceId, session.email)) ? session : null;
}

/**
 * Returns the current session or null. Convenience re-export so routes
 * only need to import from one auth module.
 */
export { getSession, type SessionPayload } from '@/lib/session';
