/**
 * Profile spaces API — which spaces appear on a person's profile.
 *
 * GET  /api/profile/[personId]/communities
 *   Top-level spaces the person manages (holds an alias that manages it — always listed) plus member
 *   spaces they've opted into showing (SpaceMember.privateMeta.showOnProfile).
 *   The owner gets ALL their spaces with visibility flags so the panel
 *   can render toggles; other viewers only get the visible ones.
 *
 * PATCH /api/profile/[personId]/communities  (owner only)
 *   { spaceId, showOnProfile } — toggle a member space's visibility.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiSession, forbiddenResponse } from '@/lib/api/route';
import { normalizeImageUrl } from '@/lib/mediaUrl';
import { adminSpaceIds } from '@/lib/auth';
import { resolveProfileUserId } from '@/lib/identity/connection';

type RouteContext = { params: Promise<{ personId: string }> };

export interface ProfileSpace {
  id: string;
  name: string;
  imageUrl: string | null;
  visibility: string;
  memberCount: number;
  /** Whether this person holds an alias that manages the space. */
  isAdmin: boolean;
  /** Member spaces only — owner has opted in to showing it. */
  showOnProfile: boolean;
  /** Managed spaces are always visible; the rest only when opted in. */
  visible: boolean;
}

async function loadRows(userId: string) {
  return prisma.spaceMember.findMany({
    where: {
      userId,
      status: 'active',
      // Personal spaces aren't spaces, and a sub-space is part of its parent,
      // not a line of its own on anyone's profile.
      space: { personalOwnerId: null, parentId: null },
    },
    include: {
      space: {
        select: {
          id: true, name: true, imageUrl: true, visibility: true,
          _count: { select: { members: { where: { status: 'active' } } } },
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { personId } = await context.params;
  const userId = await resolveProfileUserId(personId);

  // Context-only people (no linked user) have no memberships to show.
  if (!userId) return NextResponse.json({ spaces: [], isOwner: false });

  const isOwner = userId === session.userId;
  const rows = await loadRows(userId);
  const adminIds = await adminSpaceIds(
    userId,
    rows.map((r) => r.space.id),
  );

  const spaces: ProfileSpace[] = rows.map((row) => {
    const meta = (row.privateMeta ?? {}) as Record<string, unknown>;
    const showOnProfile = meta.showOnProfile === true;
    const isAdmin = adminIds.has(row.space.id);
    return {
      id: row.space.id,
      name: row.space.name,
      imageUrl: normalizeImageUrl(row.space.imageUrl) ?? row.space.imageUrl,
      visibility: row.space.visibility,
      memberCount: row.space._count.members,
      isAdmin,
      showOnProfile,
      visible: isAdmin || showOnProfile,
    };
  });

  return NextResponse.json({
    spaces: isOwner ? spaces : spaces.filter((c) => c.visible),
    isOwner,
  });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { personId } = await context.params;
  const userId = await resolveProfileUserId(personId);
  if (!userId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (userId !== session.userId) {
    return forbiddenResponse();
  }

  const body = await req.json();
  const spaceId = typeof body.spaceId === 'string' ? body.spaceId : null;
  const showOnProfile = body.showOnProfile;
  if (!spaceId || typeof showOnProfile !== 'boolean') {
    return NextResponse.json({ error: 'spaceId and showOnProfile (boolean) required' }, { status: 400 });
  }

  const membership = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId, spaceId } },
  });
  if (!membership || membership.status !== 'active') {
    return NextResponse.json({ error: 'Not a member of that space' }, { status: 404 });
  }

  // privateMeta also carries private CRM values — merge, never replace.
  const meta = (membership.privateMeta ?? {}) as Record<string, unknown>;
  await prisma.spaceMember.update({
    where: { id: membership.id },
    data: { privateMeta: { ...meta, showOnProfile } },
  });

  return NextResponse.json({ ok: true, spaceId, showOnProfile });
}
