import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession, handleApiError } from '@/lib/api/route';
import { featureAccessForbidden } from '@/lib/auth';
import { requireVisibleResource } from '@/lib/resources/visibility';
import { reindexResource } from '@/lib/resources/service';

export const maxDuration = 300;

type RouteContext = { params: Promise<{ resourceId: string }> };

/**
 * Re-run extraction, chunking and embedding for one stored file.
 *
 * The repair path for every way a file can end up un-indexed: an upload that
 * raced a bad embedding key, a change of embedding model, or a file stored
 * before the pipeline existed at all — every row that predates the Drive
 * migration is `pending` for exactly that reason.
 */
export async function POST(_req: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { resourceId } = await context.params;
  let resource;
  try {
    resource = await requireVisibleResource(resourceId, session.userId, session.email);
  } catch (err) {
    return handleApiError(err, 'resources.reindex.gate');
  }
  if (await featureAccessForbidden(session.userId, resource.spaceId, 'directory', session.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const updated = await reindexResource(resourceId);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(updated);
}
