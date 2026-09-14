/**
 * Authorization helpers for event routes.
 *
 * Events are space-scoped. Two gates:
 *  - requireSpaceMember: any logged-in member (or admin) of the space — for creating events.
 *  - requireEventManager:    a space admin OR a host of the specific event — for editing,
 *                            deleting, reading the guest list, and managing attendees.
 *
 * Both return the session payload on success, or a JSON `Response` (401/403) to early-return.
 */

import { getSession, isAdmin } from '@/lib/auth';
import { findMemberNode } from '@/lib/identity/connection';
import type { SessionPayload } from '@/lib/session';
import prisma from '@/lib/prisma';
import type { NBEvent } from '@/lib/types';
import { flowsEvents } from '@/lib/spaces/subspaces';

function deny(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Session + membership (admin or member row) of the space. */
export async function requireSpaceMember(
  spaceId: string,
): Promise<SessionPayload | Response> {
  const session = await getSession();
  if (!session) return deny(401, 'Unauthorized');
  if (await isAdmin(session.userId, spaceId, session.email)) return session;

  const membership = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId: session.userId, spaceId } },
    select: { userId: true },
  });
  if (!membership) return deny(403, 'You are not a member of this space');
  return session;
}

/**
 * Session + membership of the space, OR standing in its PARENT when the space
 * is a public sub-space (lib/spaces/subspaces.ts#flowsUp): a member of the
 * parent may READ what a public sub-space shows everyone — its public events
 * (lib/events/rollup.ts). `via` says which door opened, so the caller can keep
 * the flow-up reader to public events only. Never a manage gate: writes go
 * through `requireEventManager`, which has no such fallback.
 */
export async function requireSpaceMemberOrParent(
  spaceId: string,
): Promise<{ session: SessionPayload; via: 'member' | 'subspace' } | Response> {
  const member = await requireSpaceMember(spaceId);
  if (!(member instanceof Response)) return { session: member, via: 'member' };
  if (member.status !== 403) return member;
  const session = await getSession();
  if (!session) return deny(401, 'Unauthorized');
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { parentId: true, visibility: true, listing: true, flowEvents: true, personalOwnerId: true },
  });
  if (!space?.parentId || space.personalOwnerId || !flowsEvents(space)) return member;
  const standing = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId: session.userId, spaceId: space.parentId } },
    select: { status: true },
  });
  if (standing?.status !== 'active') return member;
  return { session, via: 'subspace' };
}

/**
 * Whether this identity may manage `event`: a space admin, or one of its hosts.
 *
 * Split out from `requireEventManager` because the MCP tools hold an identity
 * rather than a cookie session, and the one rule that decides who can edit an
 * event must not be written twice.
 */
export async function isEventManager(
  identity: Pick<SessionPayload, 'userId' | 'email'>,
  spaceId: string,
  event: NBEvent | null,
): Promise<boolean> {
  if (await isAdmin(identity.userId, spaceId, identity.email)) return true;
  const hosts = event?.hosts ?? [];
  if (!hosts.length) return false;
  // Hosts are node ids in the event's space; the caller's is their member node there.
  const node = await findMemberNode(spaceId, identity.userId);
  return !!node && hosts.includes(node.id);
}

/** The message a failed manager check gives, in both transports. */
export const EVENT_MANAGER_DENIAL = 'Only the event hosts or a space admin can manage this event';

/** Session + (space admin OR a host of `event`). */
export async function requireEventManager(
  spaceId: string,
  event: NBEvent | null,
): Promise<SessionPayload | Response> {
  const session = await getSession();
  if (!session) return deny(401, 'Unauthorized');
  if (await isEventManager(session, spaceId, event)) return session;
  return deny(403, EVENT_MANAGER_DENIAL);
}
