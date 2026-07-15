import { NextResponse } from 'next/server';
import { isSuperAdmin } from '@/lib/session';
import { requireApiSession } from '@/lib/api/route';
import { listUserCommunities } from '@/lib/communities/queries';

/**
 * GET: Return all communities the current user has joined
 */
export async function GET() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const communities = await listUserCommunities(session);

  return NextResponse.json({ communities, isSuperAdmin: isSuperAdmin(session.email) });
}
