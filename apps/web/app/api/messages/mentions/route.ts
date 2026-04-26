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
    const communityId = searchParams.get('communityId');

    if (type === 'event' && communityId) {
      // Search events (nodes with type='Event') in the community
      const events = await prisma.node.findMany({
        where: {
          communityId,
          type: 'Event',
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

    // Default: search users
    const users = await prisma.user.findMany({
      where: {
        id: { not: user.id },
        ...(q ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        } : {}),
      },
      select: {
        id: true,
        name: true,
        image: true,
        person: { select: { subtitle: true, imageUrl: true } },
      },
      orderBy: { name: 'asc' },
      take: 10,
    });

    return NextResponse.json({
      results: users.map((u) => ({
        id: u.id,
        name: u.name,
        imageUrl: u.person?.imageUrl ?? u.image,
        subtitle: u.person?.subtitle,
        type: 'user',
      })),
    });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
