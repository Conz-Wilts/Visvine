import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSession } from '@/lib/session';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * POST: Current user joins a community (self-service)
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ communityId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { communityId } = await params;

  try {
    const community = await prisma.community.findUnique({ where: { id: communityId }, select: { id: true } });
    if (!community) return NextResponse.json({ error: 'Community not found' }, { status: 404 });

    const membership = await prisma.userCommunity.upsert({
      where: { userId_communityId: { userId: session.userId, communityId } },
      create: { userId: session.userId, communityId, role: 'member' },
      update: {},
      select: { id: true, role: true },
    });

    // Sync the user's public profile to their person node in this community
    const person = await prisma.person.findUnique({
      where: { userId: session.userId },
      select: {
        id: true,
        user: { select: { publicMeta: true } },
      },
    });
    if (person) {
      const pub = (person.user?.publicMeta ?? {}) as Record<string, unknown>;
      const nodeUpdate: Record<string, unknown> = {};
      if (typeof pub.name === 'string' && pub.name) nodeUpdate.name = pub.name;
      if (typeof pub.headline === 'string') nodeUpdate.subtitle = pub.headline;
      if (typeof pub.location === 'string') nodeUpdate.location = pub.location;
      if (typeof pub.avatar_url === 'string') nodeUpdate.imageUrl = pub.avatar_url;
      if (Object.keys(nodeUpdate).length > 0) {
        await prisma.node.updateMany({
          where: { id: person.id, communityId },
          data: nodeUpdate,
        });
      }
    }

    // Bust the graph cache so the node appears immediately
    revalidateTag('graph-data-v2');

    return NextResponse.json({ membership: { id: membership.id, role: membership.role } }, { status: 201 });
  } catch (err) {
    logger.error('api.community.join.failed', { err });
    return NextResponse.json({ error: 'Internal server error', detail: String(err) }, { status: 500 });
  }
}

/**
 * DELETE: Current user leaves a community (self-service)
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ communityId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { communityId } = await params;

  try {
    await prisma.userCommunity.deleteMany({
      where: { userId: session.userId, communityId },
    });

    // Note: intentionally leaving the user's node in the community graph when they leave.

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('api.community.leave.failed', { err });
    return NextResponse.json({ error: 'Internal server error', detail: String(err) }, { status: 500 });
  }
}
