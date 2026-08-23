import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession as requireAdmin } from '@/lib/auth';
import { cancelInvitation } from '@/lib/spaces/invitations';

/**
 * DELETE: withdraw an invitation nobody has answered yet (admin only). An
 * already-answered row is a 404 — the answer stands, and there is nothing left
 * to withdraw.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ spaceId: string; invitationId: string }> },
) {
  const { spaceId, invitationId } = await params;

  const session = await requireAdmin(spaceId);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const cancelled = await cancelInvitation(spaceId, invitationId);
  if (!cancelled) return NextResponse.json({ error: 'No invitation waiting' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
