/**
 * Member connection for a person context node.
 *
 *   GET    → { connected: { userId, name, email, isActive } | null }
 *   PUT    { userId } → connect (community admin, or the member claiming themself)
 *   DELETE → disconnect (community admin, or the connected member)
 *
 * The connection routes through Identity (see lib/identity/connection.ts); this
 * endpoint is the only way clients touch it — the generic node PATCH cannot.
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import prisma from '@/lib/prisma';
import { isAdmin, communityMemberForbidden } from '@/lib/auth';
import { requireApiSession, forbiddenResponse } from '@/lib/api/route';
import {
  connectNodeToUser,
  disconnectNode,
  resolveNodeConnection,
} from '@/lib/identity/connection';

type RouteContext = { params: Promise<{ nodeId: string }> };

async function loadNode(nodeId: string, viewerUserId: string, viewerEmail?: string | null) {
  const node = await prisma.node.findUnique({
    where: { id: nodeId },
    select: { id: true, type: true, communityId: true },
  });
  if (!node?.communityId) return null;
  // A node's connection (incl. the connected member's email) is member-scoped.
  if (await communityMemberForbidden(viewerUserId, node.communityId, viewerEmail)) return null;
  return node as { id: string; type: string; communityId: string };
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { nodeId } = await context.params;
  const node = await loadNode(nodeId, session.userId, session.email);
  if (!node) return NextResponse.json({ error: 'Node not found' }, { status: 404 });

  const connection = await resolveNodeConnection(nodeId);
  return NextResponse.json({
    connected: connection
      ? { userId: connection.userId, name: connection.name, email: connection.email, isActive: connection.isActive }
      : null,
  });
}

export async function PUT(req: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { nodeId } = await context.params;
  const body = await req.json().catch(() => ({}));
  const userId = typeof body.userId === 'string' ? body.userId : '';
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });

  const node = await loadNode(nodeId, session.userId, session.email);
  if (!node) return NextResponse.json({ error: 'Node not found' }, { status: 404 });

  const admin = await isAdmin(session.userId, node.communityId, session.email);
  const selfClaim = session.userId === userId;
  if (!admin && !selfClaim) return forbiddenResponse();

  // Only active members of the node's community can be connected.
  const membership = await prisma.userCommunity.findFirst({
    where: { userId, communityId: node.communityId, status: 'active' },
    select: { id: true },
  });
  if (!membership) {
    return NextResponse.json({ error: 'That user is not an active member of this space' }, { status: 400 });
  }

  const result = await connectNodeToUser(nodeId, userId, {
    actorUserId: session.userId,
    reason: selfClaim && !admin ? 'member claimed their context' : 'connected by admin',
  });
  if (!result.ok) {
    const status = result.error === 'duplicate' ? 409 : result.error === 'not_found' ? 404 : 400;
    return NextResponse.json({ error: result.message }, { status });
  }

  revalidateTag('context-data-v2', { expire: 0 });
  const connection = await resolveNodeConnection(nodeId);
  return NextResponse.json({
    connected: connection
      ? { userId: connection.userId, name: connection.name, email: connection.email, isActive: connection.isActive }
      : null,
  });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { nodeId } = await context.params;
  const node = await loadNode(nodeId, session.userId, session.email);
  if (!node) return NextResponse.json({ error: 'Node not found' }, { status: 404 });

  const connection = await resolveNodeConnection(nodeId);
  if (!connection) return NextResponse.json({ connected: null });

  const admin = await isAdmin(session.userId, node.communityId, session.email);
  if (!admin && connection.userId !== session.userId) return forbiddenResponse();

  await disconnectNode(nodeId, { actorUserId: session.userId });
  revalidateTag('context-data-v2', { expire: 0 });
  return NextResponse.json({ connected: null });
}
