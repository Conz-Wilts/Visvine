import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession as requireAdmin } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { removeMemberAccess } from '@/lib/notes/access';
import { ensureMemberNode } from '@/lib/spaces/memberNode';
import { assertMembersCanLeave } from '@/lib/notes/aliases';

/**
 * PUT: Approve a pending join request (admin only). `status: 'active'` is the
 * only field — what a member can DO comes from the aliases they hold, so that
 * is edited through /api/aliases.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string; userId: string }> }
) {
  const { spaceId, userId } = await params;

  const session = await requireAdmin(spaceId);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { status } = body as { status?: string };

  if (status !== 'active') {
    return NextResponse.json({ error: "status can only be set to 'active'" }, { status: 400 });
  }

  const existing = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId, spaceId } },
    select: { status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  const approving = existing.status !== 'active';

  const updated = await prisma.spaceMember.update({
    where: { userId_spaceId: { userId, spaceId } },
    data: { status },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
  });

  if (approving) {
    // An approved member belongs in the directory: connected person node.
    await ensureMemberNode(spaceId, userId, {
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
 * DELETE: Remove a member from a space (admin only). Refused when it would
 * leave nobody holding an alias that manages the space.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ spaceId: string; userId: string }> }
) {
  const { spaceId, userId } = await params;

  const session = await requireAdmin(spaceId);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    await assertMembersCanLeave(spaceId, [userId]);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  await prisma.spaceMember.delete({
    where: { userId_spaceId: { userId, spaceId } },
  });

  // Context access leaves with them: direct grants + the aliases they held here.
  await removeMemberAccess(spaceId, userId);

  return NextResponse.json({ success: true });
}
