import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { listMyInvitations } from '@/lib/spaces/invitations';

export const dynamic = 'force-dynamic';

/**
 * GET: the invitations waiting on the caller. The bell reads this to turn a
 * `space_invite` line into an Accept / Decline it can actually act on — the
 * notification carries the words, this carries the id.
 */
export async function GET() {
  const session = await requireSession();
  if (session instanceof Response) return session;
  return NextResponse.json({ invitations: await listMyInvitations(session.userId) });
}
