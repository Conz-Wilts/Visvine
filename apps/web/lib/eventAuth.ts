/**
 * Authorization helpers for event routes.
 *
 * Events are community-scoped. Two gates:
 *  - requireCommunityMember: any logged-in member (or admin) of the community — for creating events.
 *  - requireEventManager:    a community admin OR a host of the specific event — for editing,
 *                            deleting, reading the guest list, and managing attendees.
 *
 * Both return the session payload on success, or a JSON `Response` (401/403) to early-return.
 */

import { getSession, isAdmin } from '@/lib/auth';
import type { SessionPayload } from '@/lib/session';
import prisma from '@/lib/prisma';
import type { NBEvent } from '@/lib/types';

function deny(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Session + membership (admin or member row) of the community. */
export async function requireCommunityMember(
  communityId: string,
): Promise<SessionPayload | Response> {
  const session = await getSession();
  if (!session) return deny(401, 'Unauthorized');
  if (await isAdmin(session.userId, communityId, session.email)) return session;

  const membership = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId: session.userId, communityId } },
    select: { userId: true },
  });
  if (!membership) return deny(403, 'You are not a member of this community');
  return session;
}

/** Session + (community admin OR a host of `event`). */
export async function requireEventManager(
  communityId: string,
  event: NBEvent | null,
): Promise<SessionPayload | Response> {
  const session = await getSession();
  if (!session) return deny(401, 'Unauthorized');
  if (await isAdmin(session.userId, communityId, session.email)) return session;

  const hosts = event?.hosts ?? [];
  if (session.personId && hosts.includes(session.personId)) return session;
  return deny(403, 'Only the event hosts or a community admin can manage this event');
}
