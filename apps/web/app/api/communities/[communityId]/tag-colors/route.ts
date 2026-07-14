// Community-wide tag colour registry. Any active member may register a colour
// for a tag when they first create it (matches who can add tags to a context
// note); the colour then renders consistently everywhere. This narrowly merges
// one entry into designConfig.tagColors — it never touches other design config.

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { communityReadForbidden } from '@/lib/auth';
import { isHexColor, tagKey } from '@/lib/tagColors';

/**
 * PATCH: register (or update) a single tag's base colour.
 * Body: { tag, color }.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ communityId: string }> },
) {
  const { communityId } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { tag, color } = body as { tag?: string; color?: string };
  const key = typeof tag === 'string' ? tagKey(tag) : '';
  if (!key) return NextResponse.json({ error: 'tag is required' }, { status: 400 });
  if (!isHexColor(color)) return NextResponse.json({ error: 'valid hex color is required' }, { status: 400 });

  if (await communityReadForbidden(session.userId, communityId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const membership = await prisma.userCommunity.findFirst({
    where: { userId: session.userId, communityId, status: 'active' },
    select: { id: true },
  });
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { designConfig: true },
  });
  if (!community) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const design = (community.designConfig ?? {}) as Record<string, unknown>;
  const tagColors = { ...((design.tagColors as Record<string, string>) ?? {}) };
  // First writer wins — don't let a later create silently recolour an existing tag.
  if (!tagColors[key]) tagColors[key] = color;

  await prisma.community.update({
    where: { id: communityId },
    data: { designConfig: { ...design, tagColors } },
  });

  revalidateTag('graph-data-v2');
  return NextResponse.json({ tag: key, color: tagColors[key] });
}
