/**
 * Profile communities API — which communities appear on a person's profile.
 *
 * GET  /api/profile/[personId]/communities
 *   Communities the person manages (role=admin — always listed) plus member
 *   communities they've opted into showing (UserCommunity.privateMeta.showOnProfile).
 *   The owner gets ALL their communities with visibility flags so the panel
 *   can render toggles; other viewers only get the visible ones.
 *
 * PATCH /api/profile/[personId]/communities  (owner only)
 *   { communityId, showOnProfile } — toggle a member community's visibility.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { normalizeImageUrl } from '@/lib/mediaUrl';

type RouteContext = { params: Promise<{ personId: string }> };

export interface ProfileCommunity {
  id: string;
  name: string;
  imageUrl: string | null;
  emoji: string | null;
  visibility: string;
  memberCount: number;
  role: string;
  /** Member communities only — owner has opted in to showing it. */
  showOnProfile: boolean;
  /** admin roles are always visible; members only when opted in. */
  visible: boolean;
}

async function loadRows(userId: string) {
  return prisma.userCommunity.findMany({
    where: {
      userId,
      status: 'active',
      community: { personalOwnerId: null }, // personal spaces aren't communities
    },
    include: {
      community: {
        select: {
          id: true, name: true, imageUrl: true, emoji: true, visibility: true,
          _count: { select: { userCommunities: { where: { status: 'active' } } } },
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { personId } = await context.params;
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { userId: true },
  });

  // Graph-only people (no linked user) have no memberships to show.
  if (!person?.userId) return NextResponse.json({ communities: [], isOwner: false });

  const isOwner = person.userId === session.userId;
  const rows = await loadRows(person.userId);

  const communities: ProfileCommunity[] = rows.map((row) => {
    const meta = (row.privateMeta ?? {}) as Record<string, unknown>;
    const showOnProfile = meta.showOnProfile === true;
    const isAdmin = row.role === 'admin';
    return {
      id: row.community.id,
      name: row.community.name,
      imageUrl: normalizeImageUrl(row.community.imageUrl) ?? row.community.imageUrl,
      emoji: row.community.emoji,
      visibility: row.community.visibility,
      memberCount: row.community._count.userCommunities,
      role: row.role,
      showOnProfile,
      visible: isAdmin || showOnProfile,
    };
  });

  return NextResponse.json({
    communities: isOwner ? communities : communities.filter((c) => c.visible),
    isOwner,
  });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { personId } = await context.params;
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { userId: true },
  });
  if (!person) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (person.userId !== session.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const communityId = typeof body.communityId === 'string' ? body.communityId : null;
  const showOnProfile = body.showOnProfile;
  if (!communityId || typeof showOnProfile !== 'boolean') {
    return NextResponse.json({ error: 'communityId and showOnProfile (boolean) required' }, { status: 400 });
  }

  const membership = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId: person.userId, communityId } },
  });
  if (!membership || membership.status !== 'active') {
    return NextResponse.json({ error: 'Not a member of that community' }, { status: 404 });
  }

  // privateMeta also carries private CRM values — merge, never replace.
  const meta = (membership.privateMeta ?? {}) as Record<string, unknown>;
  await prisma.userCommunity.update({
    where: { id: membership.id },
    data: { privateMeta: { ...meta, showOnProfile } },
  });

  return NextResponse.json({ ok: true, communityId, showOnProfile });
}
