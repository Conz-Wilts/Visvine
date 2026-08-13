import { NextResponse } from 'next/server';
import { isSuperAdmin } from '@/lib/session';
import { requireApiSession } from '@/lib/api/route';
import { listUserSpaces } from '@/lib/spaces/queries';

/**
 * GET: Return all spaces the current user has joined
 */
export async function GET() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const spaces = await listUserSpaces(session);

  return NextResponse.json({ spaces, isSuperAdmin: isSuperAdmin(session.email) });
}
