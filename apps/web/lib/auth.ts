import prisma from '@/lib/prisma';
import { getSession, isSuperAdmin, type SessionPayload } from '@/lib/session';

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
