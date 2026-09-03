import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import prisma from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const user = await getApiMessagingUser();
    if (!user) return unauthorizedResponse();

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim() ?? '';
    const type = searchParams.get('type') ?? 'user';
    const spaceId = searchParams.get('spaceId');

    if (type === 'event' && spaceId) {
      // Search events (nodes with type='event') in the space
      const events = await prisma.node.findMany({
        where: {
          spaceId,
          type: 'event',
          ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
        },
        select: {
          id: true,
          name: true,
          subtitle: true,
          imageUrl: true,
          metadata: true,
        },
        orderBy: { name: 'asc' },
        take: 10,
      });

      return NextResponse.json({
        results: events.map((e) => ({
          id: e.id,
          name: e.name,
          subtitle: e.subtitle,
          imageUrl: e.imageUrl,
          type: 'event',
        })),
      });
    }

    // Default: search users — scoped to people the caller shares a real
    // (non-personal) space with, and by name only. Querying all users by
    // email platform-wide was a cross-tenant roster leak + email-existence oracle.
    const mySpaces = await prisma.spaceMember.findMany({
      where: { userId: user.id, status: 'active', space: { personalOwnerId: null } },
      select: { spaceId: true },
    });
    const spaceIds = mySpaces.map((c) => c.spaceId);
    const users = spaceIds.length === 0 ? [] : await prisma.user.findMany({
      where: {
        id: { not: user.id },
        memberships: { some: { spaceId: { in: spaceIds }, status: 'active' } },
        ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
      },
      select: {
        id: true,
        name: true,
        image: true,
        subtitle: true,
      },
      orderBy: { name: 'asc' },
      take: 10,
    });

    return NextResponse.json({
      results: users.map((u) => ({
        id: u.id,
        name: u.name,
        imageUrl: u.image,
        subtitle: u.subtitle,
        type: 'user',
      })),
    });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
