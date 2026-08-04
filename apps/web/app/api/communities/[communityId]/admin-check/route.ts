import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { isAdmin as isCommunityAdmin } from '@/lib/auth';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ isAdmin: false, communityId });
  }

  const isAdmin = await isCommunityAdmin(session.userId, communityId, session.email);
  return NextResponse.json({ isAdmin, communityId });
}
