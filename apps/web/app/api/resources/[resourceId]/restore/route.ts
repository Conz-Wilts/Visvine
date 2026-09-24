import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession, handleApiError, forbiddenResponse } from '@/lib/api/route';
import { requireVisibleResource } from '@/lib/resources/visibility';
import { canManageResource } from '@/lib/resources/shared/visibility';
import { restoreResource } from '@/lib/resources/shares';

/** POST /api/resources/[resourceId]/restore — bring a trashed resource back. Its creator's or an admin's. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ resourceId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    const { resourceId } = await params;
    const gate = await requireVisibleResource(resourceId, session.userId, session.email, { trash: true });
    if (!canManageResource(gate.viewer, gate)) return forbiddenResponse();
    await restoreResource(resourceId);
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err, 'resources.restore');
  }
}
