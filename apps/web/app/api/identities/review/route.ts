import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import prisma from '@/lib/prisma';
import { getSession, isAdmin, isSuperAdmin } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { listSuggestions, mergeIdentities, splitNodeToNewIdentity } from '@/lib/identity/steward';
import { confirmIdentity, rejectIdentityMatch } from '@/lib/identity/resolve';

/** True if the session may steward identity decisions for the given node. */
async function canStewardNode(
  session: { userId: string; email: string },
  nodeId: string,
): Promise<boolean> {
  if (isSuperAdmin(session.email)) return true;
  const node = await prisma.node.findUnique({ where: { id: nodeId }, select: { communityId: true } });
  if (!node?.communityId) return false;
  return isAdmin(session.userId, node.communityId, session.email);
}

/**
 * GET /api/identities/review — the dedup review queue (pending Tier-C suggestions).
 * Super admins see all; community admins see only suggestions for their communities.
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let communityIds: string[] | null = null;
    if (!isSuperAdmin(session.email)) {
      const memberships = await prisma.userCommunity.findMany({
        where: { userId: session.userId, role: 'admin' },
        select: { communityId: true },
      });
      communityIds = memberships.map((m) => m.communityId);
      if (communityIds.length === 0) return NextResponse.json({ suggestions: [] });
    }

    const suggestions = await listSuggestions({ communityIds });
    return NextResponse.json({ suggestions });
  } catch (err) {
    logger.error('api.identities.review.get.failed', { err });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/identities/review — act on a suggestion.
 *  { action: 'merge',   nodeId, targetIdentityId }  fold node's identity into target
 *  { action: 'reject',  nodeId, identityId }        record anti-match (different person)
 *  { action: 'split',   nodeId }                    detach node into a fresh identity
 *  { action: 'confirm', nodeId, identityId }        attach node to identity (and record)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { action, nodeId } = body as { action: string; nodeId?: string };
    if (!action || !nodeId) {
      return NextResponse.json({ error: 'action and nodeId are required' }, { status: 400 });
    }
    if (!(await canStewardNode(session, nodeId))) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const actorUserId = session.userId;

    if (action === 'reject') {
      const { identityId } = body as { identityId?: string };
      if (!identityId) return NextResponse.json({ error: 'identityId is required' }, { status: 400 });
      await rejectIdentityMatch(nodeId, identityId, { actorUserId });
      return NextResponse.json({ ok: true });
    }

    if (action === 'split') {
      const result = await splitNodeToNewIdentity(nodeId, { actorUserId });
      if (!result.ok) return NextResponse.json({ error: result.error ?? 'split failed' }, { status: 400 });
      revalidateTag('graph-data-v2');
      return NextResponse.json(result);
    }

    if (action === 'confirm') {
      const { identityId } = body as { identityId?: string };
      if (!identityId) return NextResponse.json({ error: 'identityId is required' }, { status: 400 });
      const ok = await confirmIdentity(nodeId, identityId, { actorUserId });
      if (!ok) return NextResponse.json({ error: 'identity not found' }, { status: 404 });
      await prisma.node.update({ where: { id: nodeId }, data: { identityId } });
      revalidateTag('graph-data-v2');
      return NextResponse.json({ ok: true });
    }

    if (action === 'merge') {
      const { targetIdentityId } = body as { targetIdentityId?: string };
      if (!targetIdentityId) return NextResponse.json({ error: 'targetIdentityId is required' }, { status: 400 });
      const node = await prisma.node.findUnique({ where: { id: nodeId }, select: { identityId: true } });
      if (!node?.identityId) return NextResponse.json({ error: 'node has no identity to merge' }, { status: 400 });
      const result = await mergeIdentities(node.identityId, targetIdentityId, { actorUserId });
      if (!result.ok) return NextResponse.json({ error: result.error ?? 'merge failed' }, { status: 400 });
      revalidateTag('graph-data-v2');
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    logger.error('api.identities.review.post.failed', { err });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
