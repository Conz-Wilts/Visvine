import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession as requireAdmin } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { removeMemberAccess } from '@/lib/notes/access';
import { ensureMemberNode } from '@/lib/communities/memberNode';
import { assertMembersCanLeave } from '@/lib/notes/aliases';

/**
 * PUT: Approve a pending join request (admin only). `status: 'active'` is the
 * only field — what a member can DO comes from the aliases they hold, so that
 * is edited through /api/aliases. Approving bumps the community's memberCount.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ communityId: string; userId: string }> }
) {
  const { communityId, userId } = await params;

  const session = await requireAdmin(communityId);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { status } = body as { status?: string };

  if (status !== 'active') {
    return NextResponse.json({ error: "status can only be set to 'active'" }, { status: 400 });
  }

  const existing = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId, communityId } },
    select: { status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  const approving = existing.status !== 'active';

  const updated = await prisma.userCommunity.update({
    where: { userId_communityId: { userId, communityId } },
    data: { status },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
  });

  if (approving) {
    await prisma.community.update({
      where: { id: communityId },
      data: { memberCount: { increment: 1 } },
    });
    // An approved member belongs in the directory: connected person node.
    await ensureMemberNode(communityId, userId, {
      id: session.userId,
      name: session.name,
      email: session.email ?? null,
    });
  }

  return NextResponse.json({
    member: {
      id: updated.id,
      userId: updated.userId,
      status: updated.status,
      joinedAt: updated.joinedAt.toISOString(),
      user: updated.user,
    },
  });
}

/**
 * DELETE: Remove a member from a community (admin only). Refused when it would
 * leave nobody holding an alias that manages the community.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ communityId: string; userId: string }> }
) {
  const { communityId, userId } = await params;

  const session = await requireAdmin(communityId);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    await assertMembersCanLeave(communityId, [userId]);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const membership = await prisma.userCommunity.delete({
    where: { userId_communityId: { userId, communityId } },
  });

  // Brain access leaves with them: direct grants + the aliases they held here.
  await removeMemberAccess(communityId, userId);

  // Only active members counted toward memberCount; pending (denied) ones didn't.
  if (membership.status === 'active') {
    await prisma.community.update({
      where: { id: communityId },
      data: { memberCount: { decrement: 1 } },
    });
  }

  return NextResponse.json({ success: true });
}
