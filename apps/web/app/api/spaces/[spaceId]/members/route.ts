import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession as requireAdmin } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { loadPersonAliases } from '@/lib/notes/aliases';

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
 * There is deliberately no POST here. Being in a space is something the person
 * agrees to, so joining is always their act: the public join, or the space's
 * invite link, which writes a PENDING member row. An admin turns that into a
 * member with the PUT on [userId] — they approve, they never enrol.
 */
