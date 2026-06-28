import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession as requireAdmin } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logActivity } from '@/lib/activityLog';

/**
 * PUT: Update a member's role (admin only)
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

  // Prevent self-demotion to avoid locking out the only admin
  if (userId === session.userId) {
    const adminCount = await prisma.userCommunity.count({
      where: { communityId, role: 'admin' },
    });
    const body = await req.json();
    if (body.role !== 'admin' && adminCount <= 1) {
      return NextResponse.json(
        { error: 'Cannot demote the only admin. Promote another member first.' },
        { status: 400 }
      );
    }
  }

  const body = await req.json();
  const { role } = body as { role: string };
  if (!['member', 'admin'].includes(role)) {
    return NextResponse.json({ error: 'role must be member or admin' }, { status: 400 });
  }

  const updated = await prisma.userCommunity.update({
    where: { userId_communityId: { userId, communityId } },
    data: { role },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
  });

  await logActivity({
    communityId,
    actorEmail: session.email,
    actorName: session.name,
    action: 'role_changed',
    targetEmail: updated.user.email,
    targetName: updated.user.name,
    details: { newRole: role },
  });

  return NextResponse.json({
    member: {
      id: updated.id,
      userId: updated.userId,
      role: updated.role,
      joinedAt: updated.joinedAt.toISOString(),
      user: updated.user,
    },
  });
}

/**
 * DELETE: Remove a member from a community (admin only; admin cannot remove themselves if sole admin)
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

  if (userId === session.userId) {
    const adminCount = await prisma.userCommunity.count({
      where: { communityId, role: 'admin' },
    });
    if (adminCount <= 1) {
      return NextResponse.json(
        { error: 'Cannot remove the only admin. Transfer ownership first.' },
        { status: 400 }
      );
    }
  }

  const membership = await prisma.userCommunity.delete({
    where: { userId_communityId: { userId, communityId } },
    include: { user: { select: { email: true, name: true } } },
  });

  await logActivity({
    communityId,
    actorEmail: session.email,
    actorName: session.name,
    action: 'member_removed',
    targetEmail: membership.user.email,
    targetName: membership.user.name,
  });

  return NextResponse.json({ success: true });
}
