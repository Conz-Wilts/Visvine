import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { respondToInvitation } from '@/lib/spaces/invitations';

export const dynamic = 'force-dynamic';

/**
 * POST `{ action: 'accept' | 'decline' }` — the invitee's answer, given from
 * the bell. Accepting is what creates the membership and hands over the
 * aliases the admin staged; nothing before this point granted anything.
 *
 * Only the row's own invitee can answer it (`respondToInvitation` matches on
 * the session user), and only once.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ invitationId: string }> }) {
  const { invitationId } = await params;

  const session = await requireSession();
  if (session instanceof Response) return session;

  const body = (await req.json().catch(() => ({}))) as { action?: unknown };
  if (body.action !== 'accept' && body.action !== 'decline') {
    return NextResponse.json({ error: "action must be 'accept' or 'decline'" }, { status: 400 });
  }

  const result = await respondToInvitation(session.userId, invitationId, body.action);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ action: result.action, spaceId: result.spaceId });
}
