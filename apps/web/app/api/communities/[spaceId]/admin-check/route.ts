import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { isAdmin as isSpaceAdmin } from '@/lib/auth';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ isAdmin: false, spaceId });
  }

  const isAdmin = await isSpaceAdmin(session.userId, spaceId, session.email);
  return NextResponse.json({ isAdmin, spaceId });
}
