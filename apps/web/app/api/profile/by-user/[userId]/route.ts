/**
 * Profile-by-user API — resolves a messaging participant (User id) to their
 * person profile, powering the profile side panel on the Messages page.
 * GET /api/profile/by-user/[userId] → { user, person | null }
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { normalizeImageUrl } from '@/lib/mediaUrl';

type RouteContext = { params: Promise<{ userId: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { userId } = await context.params;

  const [user, person, sharedCommunity, sharedConversation] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, image: true, createdAt: true },
    }),
    prisma.person.findUnique({ where: { userId } }),
    userId === session.userId
      ? Promise.resolve(null)
      : prisma.userCommunity.findFirst({
          where: {
            userId,
            community: { userCommunities: { some: { userId: session.userId } } },
          },
          select: { id: true },
        }),
    userId === session.userId
      ? Promise.resolve(null)
      : prisma.conversationMember.findFirst({
          where: {
            userId,
            conversation: { members: { some: { userId: session.userId } } },
          },
          select: { id: true },
        }),
  ]);

  // Tenancy guard: only expose a profile to users who share a community or a
  // conversation with the target (or to the target themselves).
  const allowed = userId === session.userId || sharedCommunity || sharedConversation;
  if (!user || !allowed) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json(
    {
      user: { ...user, image: normalizeImageUrl(user.image) ?? user.image },
      person: person
        ? {
            id: person.id,
            name: person.name,
            subtitle: person.subtitle,
            bio: person.bio,
            location: person.location,
            website: person.website,
            linkedinUrl: person.linkedinUrl,
            twitterUrl: person.twitterUrl,
            pronouns: person.pronouns,
            openToWork: person.openToWork,
            imageUrl: normalizeImageUrl(person.imageUrl) ?? person.imageUrl,
            tags: person.tags,
          }
        : null,
    },
    { headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' } },
  );
}
