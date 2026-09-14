import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api/route';
import { featureAccessForbidden } from '@/lib/auth';
import prisma from '@/lib/prisma';
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
  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { spaceId: true },
  });
  if (!resource) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (await featureAccessForbidden(session.userId, resource.spaceId, 'directory', session.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const updated = await reindexResource(resourceId);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(updated);
}
