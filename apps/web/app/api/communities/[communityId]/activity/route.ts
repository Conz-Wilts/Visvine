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
 * GET: Fetch recent activity log entries for a community (admin only)
 * Note: Activity logging not implemented yet - returns empty array
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params;

  const session = await requireAdmin(communityId);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Activity logging not implemented - return empty
  return NextResponse.json({ logs: [] });
}
