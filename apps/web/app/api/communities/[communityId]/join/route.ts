import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireApiSession } from '@/lib/api/route';
import { isForeignPersonalSpace } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { removeMemberAccess } from '@/lib/notes/access';
import { aliasesForType, type CommunityAlias } from '@/lib/types';

/**
 * POST: Current user joins a community (self-service)
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ communityId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { communityId } = await params;

  // The client sends the chosen identity (e.g. "Founder") in the body. It's
  // optional — some communities have no aliases at all.
  const body = (await req.json().catch(() => ({}))) as { alias?: unknown };
  const requestedAlias = typeof body.alias === 'string' ? body.alias.trim() : '';

  try {
    const community = await prisma.community.findUnique({
      where: { id: communityId },
      select: { id: true, communityAliases: true, personalOwnerId: true, visibility: true },
    });
    if (!community) return NextResponse.json({ error: 'Community not found' }, { status: 404 });

    // Personal spaces (me:<userId>) are private single-member communities —
    // nobody but the owner may join one.
    if (isForeignPersonalSpace(community.personalOwnerId, session.userId)) {
      return NextResponse.json({ error: 'This community is private' }, { status: 403 });
    }

    // Private communities are not self-joinable — entry is via an invite link
    // (which creates a pending request) or an admin adding the user directly.
    if (community.visibility === 'private') {
      const existing = await prisma.userCommunity.findUnique({
        where: { userId_communityId: { userId: session.userId, communityId } },
        select: { id: true },
      });
      if (!existing) {
        return NextResponse.json(
          { error: 'This community is private. Ask an admin for an invite link.' },
          { status: 403 }
        );
      }
    }

    // A user joins as a Person node, so they may only identify with a
    // Person-type alias. Anything else (an Organization alias, or an unknown
    // string) is ignored rather than trusted from the client.
    const personAliases = aliasesForType(
      (community.communityAliases ?? []) as unknown as CommunityAlias[],
      'Person',
    );
    const resolvedAlias = personAliases.find(
      (a) => a.name.toLowerCase() === requestedAlias.toLowerCase(),
    )?.name;

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
      if (resolvedAlias) nodeUpdate.alias = resolvedAlias;
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
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { communityId } = await params;

  try {
    await prisma.userCommunity.deleteMany({
      where: { userId: session.userId, communityId },
    });

    // Brain access leaves with them: direct grants + team memberships here.
    await removeMemberAccess(communityId, session.userId);

    // Note: intentionally leaving the user's node in the community graph when they leave.

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('api.community.leave.failed', { err });
    return NextResponse.json({ error: 'Internal server error', detail: String(err) }, { status: 500 });
  }
}
