import { NextRequest, NextResponse } from 'next/server';
import { getSession, isSuperAdmin } from '@/lib/session';
import prisma from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params;

  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!isSuperAdmin(session.email)) {
    const membership = await prisma.userCommunity.findUnique({
      where: { userId_communityId: { userId: session.userId, communityId } },
      select: { role: true },
    });
    if (membership?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  // Submissions system not yet implemented — return empty list
  return NextResponse.json({ submissions: [] });
}
