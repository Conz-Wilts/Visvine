import { NextRequest, NextResponse } from 'next/server';
import { getSession, isSuperAdmin } from '@/lib/session';
import prisma from '@/lib/prisma';
import { logActivity } from '@/lib/activityLog';

async function requireAdmin(communityId: string) {
  const session = await getSession();
  if (!session) return null;
  if (isSuperAdmin(session.email)) return session;
  const membership = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId: session.userId, communityId } },
    select: { role: true },
  });
  if (membership?.role !== 'admin') return null;
  return session;
}

/**
 * GET: List all members of a community (admin only)
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params;

  const session = await requireAdmin(communityId);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const memberships = await prisma.userCommunity.findMany({
    where: { communityId },
    include: { user: { select: { id: true, name: true, email: true, image: true, createdAt: true } } },
    orderBy: { joinedAt: 'asc' },
  });

  const members = memberships.map(m => ({
    id: m.id,
    userId: m.userId,
    role: m.role,
    joinedAt: m.joinedAt.toISOString(),
    user: {
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      image: m.user.image,
      createdAt: m.user.createdAt.toISOString(),
    },
  }));

  return NextResponse.json({ members });
}

/**
 * POST: Add a user to a community by email (admin only)
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params;

  const session = await requireAdmin(communityId);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { email, role = 'member' } = body as { email: string; role?: string };

  if (!email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }
  if (!['member', 'admin'].includes(role)) {
    return NextResponse.json({ error: 'role must be member or admin' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json({ error: 'No user found with that email' }, { status: 404 });
  }

  const existing = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId: user.id, communityId } },
  });
  if (existing) {
    return NextResponse.json({ error: 'User is already a member' }, { status: 409 });
  }

  const membership = await prisma.userCommunity.create({
    data: { userId: user.id, communityId, role },
    include: { user: { select: { id: true, name: true, email: true, image: true, createdAt: true } } },
  });

  await logActivity({
    communityId,
    actorEmail: session.email,
    actorName: session.name,
    action: 'member_added',
    targetEmail: membership.user.email,
    targetName: membership.user.name,
    details: { role },
  });

  return NextResponse.json({
    member: {
      id: membership.id,
      userId: membership.userId,
      role: membership.role,
      joinedAt: membership.joinedAt.toISOString(),
      user: {
        id: membership.user.id,
        name: membership.user.name,
        email: membership.user.email,
        image: membership.user.image,
        createdAt: membership.user.createdAt.toISOString(),
      },
    },
  }, { status: 201 });
}
