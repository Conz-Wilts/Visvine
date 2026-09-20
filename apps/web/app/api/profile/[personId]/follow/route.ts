/**
 * Follow API — one person's stated interest in another.
 *
 * GET    /api/profile/[personId]/follow → { following, followers, followingCount }
 * POST   /api/profile/[personId]/follow → follow (idempotent)
 * DELETE /api/profile/[personId]/follow → unfollow (idempotent)
 *
 * A follow grants nothing: no space, no grant, no contact detail. It is read by
 * the profile header and by nothing that decides access. Only a person node
 * that resolves to a member can be followed — a context-only card has no one
 * behind it to follow.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiSession } from '@/lib/api/route';
import { resolveProfileUserId } from '@/lib/identity/connection';

type RouteContext = { params: Promise<{ personId: string }> };

export interface FollowState {
  /** The viewer follows this person. */
  following: boolean;
  /** How many people follow this person. */
  followers: number;
  /** How many people this person follows. */
  followingCount: number;
  /** False when nobody is behind the node, so the button isn't offered. */
  followable: boolean;
  /** The viewer is this person. */
  isSelf: boolean;
}

async function state(viewerId: string, userId: string | null): Promise<FollowState> {
  if (!userId) {
    return { following: false, followers: 0, followingCount: 0, followable: false, isSelf: false };
  }
  const [mine, followers, followingCount] = await Promise.all([
    viewerId === userId
      ? Promise.resolve(null)
      : prisma.follow.findUnique({
          where: { followerId_followeeId: { followerId: viewerId, followeeId: userId } },
          select: { id: true },
        }),
    prisma.follow.count({ where: { followeeId: userId } }),
    prisma.follow.count({ where: { followerId: userId } }),
  ]);
  return {
    following: mine !== null,
    followers,
    followingCount,
    followable: viewerId !== userId,
    isSelf: viewerId === userId,
  };
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { personId } = await context.params;
  const userId = await resolveProfileUserId(personId);
  return NextResponse.json(await state(session.userId, userId));
}

export async function POST(_req: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { personId } = await context.params;
  const userId = await resolveProfileUserId(personId);
  if (!userId) return NextResponse.json({ error: 'Nobody to follow' }, { status: 404 });
  if (userId === session.userId) {
    return NextResponse.json({ error: 'You cannot follow yourself' }, { status: 400 });
  }
  await prisma.follow.upsert({
    where: { followerId_followeeId: { followerId: session.userId, followeeId: userId } },
    create: { followerId: session.userId, followeeId: userId },
    update: {},
  });
  return NextResponse.json(await state(session.userId, userId));
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { personId } = await context.params;
  const userId = await resolveProfileUserId(personId);
  if (!userId) return NextResponse.json({ error: 'Nobody to follow' }, { status: 404 });
  await prisma.follow.deleteMany({ where: { followerId: session.userId, followeeId: userId } });
  return NextResponse.json(await state(session.userId, userId));
}
