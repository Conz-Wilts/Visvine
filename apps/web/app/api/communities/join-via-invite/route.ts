import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireSession } from '@/lib/session';
import { handleApiError } from '@/lib/api/route';

/**
 * POST /api/communities/join-via-invite — accept a community invite link.
 *
 * Resolves the community by its invite token and records a *pending* membership
 * for the signed-in user (invite-link joins require admin approval in the
 * console). Idempotent: an existing active member is a no-op; an existing pending
 * request stays pending.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    if (session instanceof Response) return session;

    const body = await request.json().catch(() => ({}));
    const token = typeof body.token === 'string' ? body.token : '';
    if (!token) {
      return NextResponse.json({ error: 'Invite token is required' }, { status: 400 });
    }

    const community = await prisma.community.findUnique({
      where: { inviteToken: token },
      select: { id: true, name: true },
    });
    if (!community) {
      return NextResponse.json({ error: 'This invite link is invalid or has been revoked.' }, { status: 404 });
    }

    const existing = await prisma.userCommunity.findUnique({
      where: { userId_communityId: { userId: session.userId, communityId: community.id } },
      select: { status: true },
    });

    if (existing?.status === 'active') {
      return NextResponse.json({ status: 'active', communityId: community.id, communityName: community.name });
    }
    if (existing?.status === 'pending') {
      return NextResponse.json({ status: 'pending', communityId: community.id, communityName: community.name });
    }

    await prisma.userCommunity.create({
      data: { userId: session.userId, communityId: community.id, role: 'member', status: 'pending' },
    });

    return NextResponse.json({ status: 'pending', communityId: community.id, communityName: community.name });
  } catch (err) {
    return handleApiError(err, 'api.communities.join_via_invite.failed');
  }
}
