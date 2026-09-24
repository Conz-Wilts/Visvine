import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiSession, handleApiError, ApiError } from '@/lib/api/route';
import { requireVisibleResource } from '@/lib/resources/visibility';
import { loadView } from '@/lib/resources/views';
import { enqueueJobs } from '@/lib/resources/jobs';

/** A link not read for this long is read again when someone opens it. */
const LINK_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * GET /api/resources/[resourceId]/view — the resource as the viewer draws it
 * (lib/resources/shared/view.ts). A stale link is queued to be read again,
 * finished by the viewer's pull or the tick.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ resourceId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    const { resourceId } = await params;
    const gate = await requireVisibleResource(resourceId, session.userId, session.email, { trash: true });
    if (gate.source === 'link') {
      const row = await prisma.resource.findUnique({ where: { id: gate.id }, select: { fetchedAt: true, fetchState: true } });
      const stale = !row?.fetchedAt || Date.now() - row.fetchedAt.getTime() > LINK_STALE_MS;
      if (row && stale && row.fetchState !== 'pending') await enqueueJobs(gate.id, ['refresh']);
    }
    const view = await loadView(gate.id, gate.viewer);
    if (!view) throw new ApiError(404, 'Not found');
    return NextResponse.json({ resource: view });
  } catch (err) {
    return handleApiError(err, 'resources.view');
  }
}
