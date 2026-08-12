import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession as requireAdmin } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { loadPersonAliases } from '@/lib/notes/aliases';
import { ensureMemberNode } from '@/lib/communities/memberNode';

/**
 * GET: List all members of a community, each with the aliases they hold
 * (admin only). There is no role — standing is the alias list.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params;

  const session = await requireAdmin(communityId);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [memberships, held] = await Promise.all([
    prisma.userCommunity.findMany({
      where: { communityId },
      include: { user: { select: { id: true, name: true, email: true, image: true, createdAt: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
    prisma.userAlias.findMany({
      where: { communityId },
      select: { userId: true, aliasName: true },
    }),
  ]);

  const aliasesByUser = new Map<string, string[]>();
  for (const h of held) {
    aliasesByUser.set(h.userId, [...(aliasesByUser.get(h.userId) ?? []), h.aliasName]);
  }

  const members = memberships.map(m => ({
    id: m.id,
    userId: m.userId,
    aliases: aliasesByUser.get(m.userId) ?? [],
    status: m.status,
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
 * POST: Add a user to a community by email, optionally giving them aliases
 * straight away (admin only).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params;

  const session = await requireAdmin(communityId);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { email, aliases = [] } = body as { email: string; aliases?: string[] };

  if (!email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
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

  // Admin-added members are active immediately (no approval needed).
  const membership = await prisma.userCommunity.create({
    data: { userId: user.id, communityId, status: 'active', addedBy: session.userId },
    include: { user: { select: { id: true, name: true, email: true, image: true, createdAt: true } } },
  });

  // Only Person aliases this community actually defines — anything else is
  // silently ignored rather than creating a holder of a name that doesn't exist.
  const known = new Set((await loadPersonAliases(communityId)).map(a => a.name));
  const granted = aliases.filter(a => known.has(a));
  if (granted.length) {
    await prisma.userAlias.createMany({
      data: granted.map(aliasName => ({ communityId, aliasName, userId: user.id, addedBy: session.userId })),
      skipDuplicates: true,
    });
  }

  await prisma.community.update({
    where: { id: communityId },
    data: { memberCount: { increment: 1 } },
  });

  // The new member's connected person node in this directory (best-effort).
  await ensureMemberNode(communityId, user.id, {
    id: session.userId,
    name: session.name,
    email: session.email ?? null,
  });

  return NextResponse.json({
    member: {
      id: membership.id,
      userId: membership.userId,
      aliases: granted,
      status: membership.status,
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
