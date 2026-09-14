import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireSession } from '@/lib/session';
import { handleApiError } from '@/lib/api/route';

/**
 * POST /api/spaces/join-via-invite — accept a space invite link.
 *
 * Resolves the space by its invite token and records a *pending* membership
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

    const space = await prisma.space.findUnique({
      where: { inviteToken: token },
      select: { id: true, name: true },
    });
    if (!space) {
      return NextResponse.json({ error: 'This invite link is invalid or has been revoked.' }, { status: 404 });
    }

    const existing = await prisma.spaceMember.findUnique({
      where: { userId_spaceId: { userId: session.userId, spaceId: space.id } },
      select: { status: true },
    });

    if (existing?.status === 'active') {
      return NextResponse.json({ status: 'active', spaceId: space.id, spaceName: space.name });
    }
    if (existing?.status === 'pending') {
      return NextResponse.json({ status: 'pending', spaceId: space.id, spaceName: space.name });
    }

    await prisma.spaceMember.create({
      data: { userId: session.userId, spaceId: space.id, status: 'pending' },
    });

    return NextResponse.json({ status: 'pending', spaceId: space.id, spaceName: space.name });
  } catch (err) {
    return handleApiError(err, 'api.spaces.join_via_invite.failed');
  }
}
