import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireApiSession } from '@/lib/api/route';
import { isForeignPersonalSpace } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { removeMemberAccess } from '@/lib/notes/access';
import { findAliasByRef, selfJoinAliases, type SpaceAlias } from '@/lib/types';
import { ensureMemberNode } from '@/lib/spaces/memberNode';
import { isGlobalSpace } from '@/lib/spaces/globalSpace';
import { selfJoinOutcome } from '@/lib/spaces/subspaceAccess';

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
      select: {
        id: true, aliases: true, personalOwnerId: true, visibility: true,
      },
    });
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    // Personal spaces (me:<userId>) are private single-member spaces —
    // nobody but the owner may join one.
    if (isForeignPersonalSpace(space.personalOwnerId, session.userId)) {
      return NextResponse.json({ error: 'This space is private' }, { status: 403 });
    }
    // The global space has no members — everyone already reads it.
    if (isGlobalSpace(space.id)) {
      return NextResponse.json({ error: 'Visvine is open to everyone; there is nothing to join' }, { status: 400 });
    }

    // The door decides (lib/spaces/subspaces.ts#joinOutcome): the house door
    // for an active member of the parent, the world door for anyone else.
    // `invite` = nothing to press; `ask` = a `pending` request an admin of
    // the space answers on Members → Wants to join; `open` = in. A pending
    // row from an earlier ask is honoured when the door has since opened.
    let requesting = false;
    let admitting = false;
    {
      const existing = await prisma.spaceMember.findUnique({
        where: { userId_spaceId: { userId: session.userId, spaceId } },
        select: { id: true, status: true },
      });
      if (!existing || existing.status === 'pending') {
        const outcome = await selfJoinOutcome(spaceId, session.userId);
        if (outcome === 'deny') {
          if (existing) {
            return NextResponse.json({ membership: { id: existing.id, status: existing.status } }, { status: 200 });
          }
          return NextResponse.json(
            { error: 'This space is invite only. Ask an admin for an invite link.' },
            { status: 403 }
          );
        }
        requesting = outcome === 'pending';
        admitting = outcome === 'active' && existing?.status === 'pending';
      }
    }

    // A user joins as a Person node, so they may only identify with a
    // Person-type alias — and never an admin one: self-join is the public door,
    // so nobody walks through it declaring themselves an admin of the space.
    // Anything else (an Organization alias, an admin alias, an unknown string)
    // is ignored rather than trusted from the client.
    const resolvedAlias = findAliasByRef(
      selfJoinAliases((space.aliases ?? []) as unknown as SpaceAlias[]),
      requestedAlias,
    );

    const membership = await prisma.spaceMember.upsert({
      where: { userId_spaceId: { userId: session.userId, spaceId } },
      create: { userId: session.userId, spaceId, status: requesting ? 'pending' : 'active' },
      update: admitting ? { status: 'active' } : {},
      select: { id: true, status: true },
    });

    // A request is not a membership yet, so nothing else happens: no person
    // node in a space they cannot see, no alias, no cache bust. The row is the
    // whole act.
    if (membership.status === 'pending') {
      return NextResponse.json(
        { membership: { id: membership.id, status: membership.status } },
        { status: 201 }
      );
    }

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
      // The canonical name, not what the client typed, plus the id it belongs to.
      await prisma.node.update({
        where: { id: nodeId },
        data: { alias: resolvedAlias.name, aliasId: resolvedAlias.id ?? null },
      });
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

    // Context access leaves with them: their grants here.
    await removeMemberAccess(spaceId, session.userId);

    // Note: intentionally leaving the user's node in the space context when they leave.

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('api.space.leave.failed', { err });
    return NextResponse.json({ error: 'Internal server error', detail: String(err) }, { status: 500 });
  }
}
