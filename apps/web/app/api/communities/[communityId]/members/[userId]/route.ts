import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession as requireAdmin } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logActivity } from '@/lib/activityLog';

/**
 * PUT: Update a member's role, or approve a pending join request (admin only).
 *
 * Body may carry `role` (change role) and/or `status: 'active'` (approve a
 * pending invite-link join request). Approving a pending member bumps the
 * community's memberCount.
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
  const { role, status } = body as { role?: string; status?: string };

  if (role !== undefined && !['member', 'admin'].includes(role)) {
    return NextResponse.json({ error: 'role must be member or admin' }, { status: 400 });
  }
  if (status !== undefined && status !== 'active') {
    return NextResponse.json({ error: 'status can only be set to active' }, { status: 400 });
  }
  if (role === undefined && status === undefined) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const existing = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId, communityId } },
    select: { status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  // Prevent demoting the only admin to avoid locking out the community.
  if (role !== undefined && role !== 'admin' && userId === session.userId) {
    const adminCount = await prisma.userCommunity.count({
      where: { communityId, role: 'admin' },
    });
    if (adminCount <= 1) {
      return NextResponse.json(
        { error: 'Cannot demote the only admin. Promote another member first.' },
        { status: 400 }
      );
    }
  }

  const approving = status === 'active' && existing.status !== 'active';

  const updated = await prisma.userCommunity.update({
    where: { userId_communityId: { userId, communityId } },
    data: {
      ...(role !== undefined && { role }),
      ...(status !== undefined && { status }),
    },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
  });

  if (approving) {
    await prisma.community.update({
      where: { id: communityId },
      data: { memberCount: { increment: 1 } },
    });
  }

  await logActivity({
    communityId,
    actorEmail: session.email,
    actorName: session.name,
    action: approving ? 'member_added' : 'role_changed',
    targetEmail: updated.user.email,
    targetName: updated.user.name,
    details: approving ? { approved: true, role: updated.role } : { newRole: role },
  });

  return NextResponse.json({
    member: {
      id: updated.id,
      userId: updated.userId,
      role: updated.role,
      status: updated.status,
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

  // Only active members counted toward memberCount; pending (denied) ones didn't.
  if (membership.status === 'active') {
    await prisma.community.update({
      where: { id: communityId },
      data: { memberCount: { decrement: 1 } },
    });
  }

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
