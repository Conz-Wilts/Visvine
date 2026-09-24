import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSignedUrl, RESOURCES_BUCKET } from '@/lib/gcs';
import { z } from 'zod';
import { requireApiSession, forbiddenResponse, parseBody, handleApiError } from '@/lib/api/route';
import { moveResource, renameResource } from '@/lib/resources/folders';
import { requireVisibleResource } from '@/lib/resources/visibility';
import { canManageResource } from '@/lib/resources/shared/visibility';
import { enqueueJobs } from '@/lib/resources/jobs';

const LINK_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * GET /api/resources/[resourceId] — one resource the caller can see (through a
 * share, or as an admin; a trashed one only to whoever may restore it), with a
 * fresh signed URL, uploader profile, activity counts and its Resource node.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ resourceId: string }> },
) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { resourceId } = await params;
  let gate;
  try {
    gate = await requireVisibleResource(resourceId, session.userId, session.email, { trash: true });
  } catch (err) {
    return handleApiError(err, 'resources.get');
  }
  const resource = await prisma.resource.findUniqueOrThrow({
    where: { id: resourceId },
    include: { _count: { select: { comments: true, changes: true } } },
  });
  const canManage = canManageResource(gate.viewer, resource);
  // A link opened a week after it was last read is read again — queued here,
  // finished by the viewer's pull or the tick.
  if (resource.source === 'link' && resource.fetchState !== 'pending' && (!resource.fetchedAt || Date.now() - resource.fetchedAt.getTime() > LINK_STALE_MS)) {
    await enqueueJobs(resource.id, ['refresh']);
  }

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

  const nodeId = resource.nodeId;
  const [uploader, pendingChanges] = await Promise.all([
    resource.createdBy
      ? prisma.user.findUnique({
          where: { id: resource.createdBy },
          select: { id: true, name: true, image: true, nodeId: true },
        })
      : Promise.resolve(null),
    prisma.resourceChange.count({ where: { resourceId, status: 'pending' } }),
  ]);

  const { _count, ...rest } = resource;
  return NextResponse.json({
    resource: {
      ...rest,
      fileUrl,
      createdAt: resource.createdAt.toISOString(),
      deletedAt: resource.deletedAt?.toISOString() ?? null,
    },
    /** The Resource this file is the content of — its page is where it is shown. */
    nodeId,
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
  try {
    const gate = await requireVisibleResource(resourceId, session.userId, session.email);
    if (!canManageResource(gate.viewer, gate)) return forbiddenResponse();
  } catch (err) {
    return handleApiError(err, 'resources.update');
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
