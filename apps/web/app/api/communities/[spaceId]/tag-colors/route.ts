// Space-wide tag colour registry. Any active member may register a colour
// for a tag when they first create it (matches who can add tags to a context
// note); the colour then renders consistently everywhere. This narrowly merges
// one entry into designConfig.tagColors — it never touches other design config.

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiSession } from '@/lib/api/route';
import { spaceReadForbidden } from '@/lib/auth';
import { isHexColor, tagKey } from '@/lib/tagColors';
import { updateSpaceConfig, UnknownSpaceError } from '@/lib/spaces/spaceConfig';
import { mergeDesignConfig } from '@/lib/spaces/configMerge';

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

  // Under the lock, so "first writer wins" is decided against what is really
  // stored — two members creating the same tag at once used to be able to read
  // the same empty registry and both write their own colour.
  try {
    const { config } = await updateSpaceConfig(spaceId, (stored) => {
      if (stored.designConfig.tagColors?.[key]) return {};
      return { designConfig: mergeDesignConfig(stored.designConfig, { tagColors: { [key]: color } }) };
    });
    return NextResponse.json({ tag: key, color: config.designConfig.tagColors?.[key] ?? color });
  } catch (err) {
    if (err instanceof UnknownSpaceError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    throw err;
  }
}
