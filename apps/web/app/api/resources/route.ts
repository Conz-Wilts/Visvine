import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api/route';
import { featureAccessForbidden } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { deleteResource, listResources } from '@/lib/resources/service';

/**
 * The Drive listing. Every row carries a freshly-signed download URL and its
 * indexing state — see lib/resources/service.ts for why neither is stored.
 */
export async function GET(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const space_id = req.nextUrl.searchParams.get('space_id');
  if (!space_id) return NextResponse.json({ error: 'space_id required' }, { status: 400 });
  // A space that has removed Resources, or restricted it to admins, refuses here
  // too — not only in the sidebar that stopped showing the link.
  if (await featureAccessForbidden(session.userId, space_id, 'directory', session.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listResources(space_id));
}

/**
 * There is no POST.
 *
 * A record used to be created here from a body the browser composed — including
 * the GCS object path, which the listing then signed a download URL for. That
 * made the object path client-controlled: a crafted create could name any object
 * in the shared resources bucket, another space's context-source originals
 * included, and be handed a signed URL to it. Uploading is now the only way a
 * row appears, and POST /api/resources/upload mints the path server-side.
 */

export async function DELETE(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const resource = await prisma.resource.findUnique({
    where: { id },
    select: { spaceId: true },
  });
  if (!resource) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (await featureAccessForbidden(session.userId, resource.spaceId, 'directory', session.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  // Drops the file's chunks from retrieval, the record, and the object it owns.
  await deleteResource(id);
  return NextResponse.json({ success: true });
}
