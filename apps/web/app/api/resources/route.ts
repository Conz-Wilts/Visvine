import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api/route';
import { featureAccessForbidden } from '@/lib/auth';
import { handleApiError } from '@/lib/api/route';
import { deleteResource, listResources } from '@/lib/resources/service';
import { requireVisibleResource } from '@/lib/resources/visibility';
import { canManageResource } from '@/lib/resources/shared/visibility';
import { trashResource } from '@/lib/resources/shares';
import { logResourceAccess } from '@/lib/resources/accessLog';

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
 * There is no POST. A row appears only through an upload
 * (`POST /api/resources/uploads`), which mints the object path server-side:
 * a path a browser composed could name any object in the shared resources
 * bucket — another space's originals included — and be signed a download URL.
 */

/**
 * DELETE /api/resources?id= — move a resource to the trash; with `forever=1`,
 * delete a trashed one outright (its chunks, record, node and bytes). Either
 * is its creator's or an admin's: seeing a file never made it yours to remove.
 */
export async function DELETE(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const forever = req.nextUrl.searchParams.get('forever') === '1';
  try {
    const resource = await requireVisibleResource(id, session.userId, session.email, { trash: forever });
    if (!canManageResource(resource.viewer, resource)) {
      return NextResponse.json({ error: 'Only its creator or an admin can delete this' }, { status: 403 });
    }
    if (forever) {
      if (!resource.deletedAt) return NextResponse.json({ error: 'Move it to the trash first' }, { status: 409 });
      await deleteResource(id);
    } else {
      await trashResource(id, session.userId);
      await logResourceAccess({ resourceId: id, spaceId: resource.spaceId, userId: session.userId, via: 'web', action: 'delete' });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err, 'resources.delete');
  }
}
