import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession as requireAdmin } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { loadPersonAliases } from '@/lib/notes/aliases';
import { findAliasByRef } from '@/lib/types/context';
import { ensureMemberNode } from '@/lib/spaces/memberNode';

/**
 * GET: List all members of a space, each with the aliases they hold
 * (admin only). There is no role — standing is the alias list.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;

  const session = await requireAdmin(spaceId);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [memberships, held, vocabulary] = await Promise.all([
    prisma.spaceMember.findMany({
      where: { spaceId },
      include: { user: { select: { id: true, name: true, email: true, image: true, createdAt: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
    prisma.userAlias.findMany({
      where: { spaceId },
      select: { userId: true, aliasId: true },
    }),
    loadPersonAliases(spaceId),
  ]);

  // Holder rows carry alias ids; the client keys off names, so they are resolved
  // here. A row whose alias is gone is skipped rather than shown as a raw id —
  // the delete cascade should have removed it, so it is stale either way.
  const nameById = new Map(vocabulary.filter((a) => a.id).map((a) => [a.id!, a.name]));
  const aliasesByUser = new Map<string, string[]>();
  for (const h of held) {
    const name = nameById.get(h.aliasId);
    if (!name) continue;
    aliasesByUser.set(h.userId, [...(aliasesByUser.get(h.userId) ?? []), name]);
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
 * POST: Add a user to a space by email, optionally giving them aliases
 * straight away (admin only).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;

  const session = await requireAdmin(spaceId);
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

  const existing = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId: user.id, spaceId } },
  });
  if (existing) {
    return NextResponse.json({ error: 'User is already a member' }, { status: 409 });
  }

  // Admin-added members are active immediately (no approval needed).
  const membership = await prisma.spaceMember.create({
    data: { userId: user.id, spaceId, status: 'active', addedBy: session.userId },
    include: { user: { select: { id: true, name: true, email: true, image: true, createdAt: true } } },
  });

  // Only Person aliases this space actually defines — anything else is silently
  // ignored rather than creating a holder of an alias that doesn't exist. The
  // invite carries names, so each is resolved to its id (case-insensitively,
  // via findAliasByRef) before the holder row is written.
  const vocabulary = await loadPersonAliases(spaceId);
  const resolved = aliases
    .map(a => findAliasByRef(vocabulary, a, 'Person'))
    .filter(a => Boolean(a?.id));
  const granted = [...new Set(resolved.map(a => a!.name))];
  const grantedIds = [...new Set(resolved.map(a => a!.id!))];
  if (grantedIds.length) {
    await prisma.userAlias.createMany({
      data: grantedIds.map(aliasId => ({ spaceId, aliasId, userId: user.id, addedBy: session.userId })),
      skipDuplicates: true,
    });
  }

  // The new member's connected person node in this directory (best-effort).
  await ensureMemberNode(spaceId, user.id, {
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
