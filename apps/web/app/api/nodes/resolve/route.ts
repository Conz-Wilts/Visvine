/**
 * Person id → context node id.
 *
 *   GET ?id=<person-or-node-id>[&spaceId=<id>] → { nodeId: string | null }
 *
 * Two different ids name a person, and they are not interchangeable:
 *
 *   - the **Person row** id (`person:<email-prefix>`, lib/auth/bootstrap.ts),
 *     which is what a session carries as `personId`; and
 *   - the **Node** id (`person:<name-slug>`, syncEntityNode via
 *     lib/spaces/memberNode.ts), one per space the member belongs to.
 *
 * They coincide only in seeded data. For anyone who signed up and then joined or
 * created a space, `person:cwnz2004` and `person:connor-wiltshire` are different
 * strings, and only the latter has a Node row — so `/directory/<personId>` used
 * to render "Profile not found". This endpoint is the mapping, so a link built
 * from a session id (the avatar menu's Profile item) still lands on the node.
 *
 * The current space wins when the member has a node in several; otherwise
 * any node the viewer is allowed to read will do.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiSession } from '@/lib/api/route';
import { spaceMemberForbidden } from '@/lib/auth';
import { findMemberNode } from '@/lib/identity/connection';

export async function GET(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const id = request.nextUrl.searchParams.get('id')?.trim();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const spaceId = request.nextUrl.searchParams.get('spaceId')?.trim() || null;

  // Already a node id — nothing to resolve.
  const asNode = await prisma.node.findUnique({ where: { id }, select: { id: true } });
  if (asNode) return NextResponse.json({ nodeId: asNode.id });

  // Otherwise it is a member's own node id (User.nodeId) or a user id.
  const user = await prisma.user.findFirst({ where: { OR: [{ nodeId: id }, { id }] }, select: { id: true } });
  const userId = user?.id;
  if (!userId) return NextResponse.json({ nodeId: null });

  if (spaceId) {
    const inSpace = await findMemberNode(spaceId, userId);
    if (inSpace && !(await spaceMemberForbidden(session.userId, spaceId, session.email))) {
      return NextResponse.json({ nodeId: inSpace.id });
    }
  }

  // Any other space's node, provided the viewer may read that space.
  // Stable order so repeated calls agree with each other.
  const candidates = await prisma.node.findMany({
    where: { identity: { userId }, spaceId: { not: null } },
    select: { id: true, spaceId: true },
    orderBy: { id: 'asc' },
  });
  for (const candidate of candidates) {
    if (!(await spaceMemberForbidden(session.userId, candidate.spaceId!, session.email))) {
      return NextResponse.json({ nodeId: candidate.id });
    }
  }

  return NextResponse.json({ nodeId: null });
}
