import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession as requireAdmin } from '@/lib/auth';
import { inviteMember, listSpaceInvitations } from '@/lib/spaces/invitations';

/**
 * The admin side of "invite by email" (lib/spaces/invitations.ts). Inviting no
 * longer adds anybody: it asks, and the person answers from their bell. Which
 * is why the invite lives here rather than on POST /members — that route made
 * a member, this one makes a request.
 */

/** GET: the invitations this space is still waiting on (admin only). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;

  const session = await requireAdmin(spaceId);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  return NextResponse.json({ invitations: await listSpaceInvitations(spaceId) });
}

/** POST `{ email, aliases? }`: ask someone to join (admin only). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;

  const session = await requireAdmin(spaceId);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { email?: unknown; aliases?: unknown };
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 });
  const aliases = Array.isArray(body.aliases)
    ? body.aliases.filter((a): a is string => typeof a === 'string')
    : [];

  const result = await inviteMember({
    spaceId,
    email,
    aliases,
    invitedBy: { id: session.userId, name: session.name },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ invitation: result.invitation }, { status: 201 });
}
