// Space-wide node type vocabulary. Any active member may add a type when
// they first name one on the draft-context surface (matches who can add a tag
// to a note); the type then colours and labels consistently everywhere. This
// narrowly appends one entry to nodeTypes — it never touches the rest of the
// space record, which is what keeps it out of the admin-only PUT.

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import prisma from '@/lib/prisma';
import { requireApiSession } from '@/lib/api/route';
import { spaceReadForbidden } from '@/lib/auth';
import { mergeNodeType, type NodeTypeConfig } from '@/lib/types';

/**
 * PATCH: add a node type, or resolve the one already serving that name.
 * Body: { name, color? }. First writer wins on the colour — recolouring is the
 * console's job, not a side effect of somebody else creating a note.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId } = await params;
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const body = await req.json().catch(() => ({}));
  const { name, color } = body as { name?: string; color?: string };
  if (typeof name !== 'string') return NextResponse.json({ error: 'name is required' }, { status: 400 });

  if (await spaceReadForbidden(session.userId, spaceId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const membership = await prisma.spaceMember.findFirst({
    where: { userId: session.userId, spaceId, status: 'active' },
    select: { id: true },
  });
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { nodeTypes: true },
  });
  if (!space) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const merged = mergeNodeType(space.nodeTypes as NodeTypeConfig[] | null, { name, color });
  if (!merged.ok) return NextResponse.json({ error: merged.error }, { status: 400 });

  // Nothing to write when the name was already served — including the case
  // where mergeNodeType only seeded the defaults it would have written anyway.
  if (merged.created) {
    await prisma.space.update({
      where: { id: spaceId },
      // Prisma types JSON columns structurally; the array is plain JSON data.
      data: { nodeTypes: merged.types as unknown as object[] },
    });
    revalidateTag('context-data-v2', { expire: 0 });
  }

  return NextResponse.json({ type: merged.type, created: merged.created });
}
