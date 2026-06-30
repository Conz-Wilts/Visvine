import prisma from '@/lib/prisma';
import { getSession, isSuperAdmin, type SessionPayload } from '@/lib/session';
import { isForeignPersonalSpace } from '@/lib/communities/personalSpace';

/**
 * Checks whether a user has admin access to a community.
 * Super-admins bypass the DB lookup.
 */
export async function isAdmin(
  userId: string,
  communityId: string,
  email?: string | null,
): Promise<boolean> {
  if (isSuperAdmin(email)) return true;
  const membership = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId, communityId } },
    select: { role: true },
  });
  return membership?.role === 'admin';
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
 * graph would otherwise be readable by any authenticated user.
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
