import { NextRequest, NextResponse } from 'next/server';
import { getSession, isSuperAdmin } from '@/lib/session';
import prisma from '@/lib/prisma';

async function requireAdmin(communityId: string) {
  const session = await getSession();
  if (!session) return null;
  if (isSuperAdmin(session.email)) return session;
  const membership = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId: session.userId, communityId } },
    select: { role: true },
  });
  if (membership?.role !== 'admin') return null;
  return session;
}

/**
 * PUT: Approve or reject a content submission (admin only)
 * Note: Content submission system not implemented yet
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ communityId: string; submissionId: string }> }
) {
  const { communityId } = await params;

  const session = await requireAdmin(communityId);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Content submission system not implemented yet
  return NextResponse.json({ error: 'Not implemented' }, { status: 501 });
}