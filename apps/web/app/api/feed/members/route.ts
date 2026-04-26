import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';

// GET /api/feed/members?communityId=xxx&q=search
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const communityId = searchParams.get('communityId');
  const q = searchParams.get('q') || '';

  if (!communityId) {
    return NextResponse.json({ error: 'communityId required' }, { status: 400 });
  }

  const members = await prisma.userCommunity.findMany({
    where: {
      communityId,
      user: q ? { name: { contains: q, mode: 'insensitive' } } : undefined,
    },
    take: 10,
    select: {
      user: {
        select: {
          id: true,
          name: true,
          image: true,
          person: { select: { subtitle: true, imageUrl: true } },
        },
      },
    },
  });

  return NextResponse.json({
    members: members.map((m) => m.user),
  });
}
