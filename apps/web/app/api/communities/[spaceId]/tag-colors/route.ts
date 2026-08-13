// Space-wide tag colour registry. Any active member may register a colour
// for a tag when they first create it (matches who can add tags to a context
// note); the colour then renders consistently everywhere. This narrowly merges
// one entry into designConfig.tagColors — it never touches other design config.

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import prisma from '@/lib/prisma';
import { requireApiSession } from '@/lib/api/route';
import { spaceReadForbidden } from '@/lib/auth';
import { isHexColor, tagKey } from '@/lib/tagColors';

/**
 * PATCH: register (or update) a single tag's base colour.
 * Body: { tag, color }.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId } = await params;
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const body = await req.json().catch(() => ({}));
  const { tag, color } = body as { tag?: string; color?: string };
  const key = typeof tag === 'string' ? tagKey(tag) : '';
  if (!key) return NextResponse.json({ error: 'tag is required' }, { status: 400 });
  if (!isHexColor(color)) return NextResponse.json({ error: 'valid hex color is required' }, { status: 400 });

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
    select: { designConfig: true },
  });
  if (!space) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const design = (space.designConfig ?? {}) as Record<string, unknown>;
  const tagColors = { ...((design.tagColors as Record<string, string>) ?? {}) };
  // First writer wins — don't let a later create silently recolour an existing tag.
  if (!tagColors[key]) tagColors[key] = color;

  await prisma.space.update({
    where: { id: spaceId },
    data: { designConfig: { ...design, tagColors } },
  });

  revalidateTag('context-data-v2', { expire: 0 });
  return NextResponse.json({ tag: key, color: tagColors[key] });
}
