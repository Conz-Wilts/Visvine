import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSignedUrl, RESOURCES_BUCKET } from '@/lib/gcs';
import { isSuperAdmin } from '@/lib/session';
import { z } from 'zod';
import { requireApiSession, forbiddenResponse, parseBody, handleApiError } from '@/lib/api/route';
import { featureAccessForbidden, isAdmin } from '@/lib/auth';
import { moveResource, renameResource } from '@/lib/resources/folders';

/**
 * GET /api/resources/[resourceId] — single resource with a fresh signed URL,
 * uploader profile, and activity counts. Space members only.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ resourceId: string }> },
) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { resourceId } = await params;
  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
    include: { _count: { select: { comments: true, changes: true } } },
  });
  if (!resource) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const membership = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId: session.userId, spaceId: resource.spaceId } },
    select: { id: true },
  });
  const superAdmin = isSuperAdmin(session.email);
  if (!membership && !superAdmin) {
    return forbiddenResponse();
  }
  const canManage = await isAdmin(session.userId, resource.spaceId, session.email);

  // A download URL is signed per read and never stored — see the note on
  // Resource.gcsPath. A row with no object (a seeded demo file) has no URL.
  let fileUrl: string | null = null;
  if (resource.gcsPath && process.env.GCS_RESOURCES_BUCKET) {
    try {
      fileUrl = await getSignedUrl(RESOURCES_BUCKET(), resource.gcsPath);
    } catch {
      // The page still renders; it just has no download link.
    }
  }

  const [uploader, pendingChanges] = await Promise.all([
    resource.uploadedBy
      ? prisma.user.findUnique({
          where: { id: resource.uploadedBy },
          select: { id: true, name: true, image: true, nodeId: true },
        })
      : Promise.resolve(null),
    prisma.resourceChange.count({ where: { resourceId, status: 'pending' } }),
  ]);

  const { _count, ...rest } = resource;
  return NextResponse.json({
    resource: { ...rest, fileUrl, createdAt: resource.createdAt.toISOString() },
    uploader: uploader
      ? {
          id: uploader.id,
          name: uploader.name,
          image: uploader.image,
          personId: uploader.nodeId,
        }
      : null,
    counts: { comments: _count.comments, changes: _count.changes, pendingChanges },
    viewer: { canManage },
  });
}

const patchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  /** The folder to move into; `null` is the Drive's root. */
  folderId: z.string().min(1).nullable().optional(),
});

/**
 * PATCH /api/resources/[resourceId] — rename and/or move a file between Drive
 * folders. Neither touches the stored object or its index.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ resourceId: string }> },
) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { resourceId } = await params;
  const resource = await prisma.resource.findUnique({ where: { id: resourceId }, select: { spaceId: true } });
  if (!resource) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (await featureAccessForbidden(session.userId, resource.spaceId, 'directory', session.email)) {
    return forbiddenResponse();
  }
  const body = await parseBody(req, patchSchema);
  if (body instanceof NextResponse) return body;
  try {
    if (body.name !== undefined) await renameResource(resourceId, body.name);
    if (body.folderId !== undefined) await moveResource(resourceId, body.folderId);
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err, 'resources.update');
  }
}
