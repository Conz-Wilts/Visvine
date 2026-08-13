import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireApiSession } from '@/lib/api/route';
import { isForeignPersonalSpace } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { removeMemberAccess } from '@/lib/notes/access';
import { aliasesForType, type SpaceAlias } from '@/lib/types';
import { ensureMemberNode } from '@/lib/spaces/memberNode';

/**
 * POST: Current user joins a space (self-service)
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { spaceId } = await params;

  // The client sends the chosen identity (e.g. "Founder") in the body. It's
  // optional — some spaces have no aliases at all.
  const body = (await req.json().catch(() => ({}))) as { alias?: unknown };
  const requestedAlias = typeof body.alias === 'string' ? body.alias.trim() : '';

  try {
    const space = await prisma.space.findUnique({
      where: { id: spaceId },
      select: { id: true, aliases: true, personalOwnerId: true, visibility: true },
    });
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    // Personal spaces (me:<userId>) are private single-member spaces —
    // nobody but the owner may join one.
    if (isForeignPersonalSpace(space.personalOwnerId, session.userId)) {
      return NextResponse.json({ error: 'This space is private' }, { status: 403 });
    }

    // Private spaces are not self-joinable — entry is via an invite link
    // (which creates a pending request) or an admin adding the user directly.
    if (space.visibility === 'private') {
      const existing = await prisma.spaceMember.findUnique({
        where: { userId_spaceId: { userId: session.userId, spaceId } },
        select: { id: true },
      });
      if (!existing) {
        return NextResponse.json(
          { error: 'This space is private. Ask an admin for an invite link.' },
          { status: 403 }
        );
      }
    }

    // A user joins as a Person node, so they may only identify with a
    // Person-type alias. Anything else (an Organization alias, or an unknown
    // string) is ignored rather than trusted from the client.
    const personAliases = aliasesForType(
      (space.aliases ?? []) as unknown as SpaceAlias[],
      'Person',
    );
    const resolvedAlias = personAliases.find(
      (a) => a.name.toLowerCase() === requestedAlias.toLowerCase(),
    )?.name;

    const membership = await prisma.spaceMember.upsert({
      where: { userId_spaceId: { userId: session.userId, spaceId } },
      create: { userId: session.userId, spaceId },
      update: {},
      select: { id: true, status: true },
    });

    // The joiner's connected person node in this space's directory. This
    // replaces the old `node.updateMany({ id: person.id, spaceId })`, which
    // silently matched nothing — a member's personal-space node never lives in
    // the space being joined.
    const nodeId = await ensureMemberNode(spaceId, session.userId, {
      id: session.userId,
      name: session.name,
      email: session.email ?? null,
    });
    if (nodeId && resolvedAlias) {
      await prisma.node.update({ where: { id: nodeId }, data: { alias: resolvedAlias } });
    }

    // Bust the context cache so the node appears immediately
    revalidateTag('context-data-v2', { expire: 0 });

    return NextResponse.json({ membership: { id: membership.id, status: membership.status } }, { status: 201 });
  } catch (err) {
    logger.error('api.space.join.failed', { err });
    return NextResponse.json({ error: 'Internal server error', detail: String(err) }, { status: 500 });
  }
}

/**
 * DELETE: Current user leaves a space (self-service)
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { spaceId } = await params;

  try {
    await prisma.spaceMember.deleteMany({
      where: { userId: session.userId, spaceId },
    });

    // Brain access leaves with them: direct grants + team memberships here.
    await removeMemberAccess(spaceId, session.userId);

    // Note: intentionally leaving the user's node in the space context when they leave.

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('api.space.leave.failed', { err });
    return NextResponse.json({ error: 'Internal server error', detail: String(err) }, { status: 500 });
  }
}
