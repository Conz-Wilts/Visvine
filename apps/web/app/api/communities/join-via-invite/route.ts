import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireSession } from '@/lib/session';
import { handleApiError } from '@/lib/api/route';
import { joinChildDenial } from '@/lib/spaces/hierarchy';
import { isActiveMemberOf } from '@/lib/spaces/tree';

/**
 * POST /api/communities/join-via-invite — accept a space invite link.
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
      select: { id: true, name: true, parent: { select: { id: true, name: true, visibility: true } } },
    });
    if (!space) {
      return NextResponse.json({ error: 'This invite link is invalid or has been revoked.' }, { status: 404 });
    }

    // A child's member is a member of its parent (docs/sub-spaces.md). The
    // invite link is not a way around the parent's door — a public parent is
    // joined here, a private one must be joined first.
    if (space.parent) {
      const parentMember = await isActiveMemberOf(session.userId, space.parent.id);
      const denied = joinChildDenial(space.parent, parentMember);
      if (denied) return NextResponse.json({ error: denied }, { status: 403 });
      if (!parentMember) {
        await prisma.spaceMember.upsert({
          where: { userId_spaceId: { userId: session.userId, spaceId: space.parent.id } },
          create: { userId: session.userId, spaceId: space.parent.id },
          update: {},
        });
      }
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
