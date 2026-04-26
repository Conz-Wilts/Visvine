import { NextRequest, NextResponse } from 'next/server';
import { getSession, isSuperAdmin } from '@/lib/session';
import prisma from '@/lib/prisma';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ isAdmin: false, communityId });
  }

  if (isSuperAdmin(session.email)) {
    return NextResponse.json({ isAdmin: true, communityId });
  }

  const membership = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId: session.userId, communityId } },
    select: { role: true },
  });

  const isAdmin = membership?.role === 'admin';
  return NextResponse.json({ isAdmin, communityId });
}
