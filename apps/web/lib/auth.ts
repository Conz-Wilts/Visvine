import prisma from '@/lib/prisma';
import { isSuperAdmin } from '@/lib/session';

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
 * Returns the current session or null. Convenience re-export so routes
 * only need to import from one auth module.
 */
export { getSession, isSuperAdmin, type SessionPayload } from '@/lib/session';
