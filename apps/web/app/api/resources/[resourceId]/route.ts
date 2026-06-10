import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSignedUrl, RESOURCES_BUCKET } from '@/lib/gcs';
import { getSession, isSuperAdmin } from '@/lib/session';

/**
 * GET /api/resources/[resourceId] — single resource with a fresh signed URL,
 * uploader profile, and activity counts. Community members only.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ resourceId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { resourceId } = await params;
  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
    include: { _count: { select: { comments: true, changes: true } } },
  });
  if (!resource) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const membership = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId: session.userId, communityId: resource.communityId } },
    select: { role: true },
  });
  const superAdmin = isSuperAdmin(session.email);
  if (!membership && !superAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const role = superAdmin ? 'admin' : membership?.role ?? null;

  // Signed URLs stored in DB expire after 15 min — regenerate from gcsPath.
  const meta = resource.metadata as Record<string, unknown> | null;
  let fileUrl = resource.fileUrl;
  const gcsPath = meta?.gcsPath as string | undefined;
  if (gcsPath) {
    try {
      fileUrl = await getSignedUrl(RESOURCES_BUCKET(), gcsPath);
    } catch {
      // fall back to the stored (possibly stale) URL
    }
  }

  const [uploader, pendingChanges] = await Promise.all([
    resource.uploadedBy
      ? prisma.user.findUnique({
          where: { id: resource.uploadedBy },
          select: { id: true, name: true, image: true, person: { select: { id: true, imageUrl: true } } },
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
          image: uploader.person?.imageUrl ?? uploader.image,
          personId: uploader.person?.id ?? null,
        }
      : null,
    counts: { comments: _count.comments, changes: _count.changes, pendingChanges },
    viewer: { role },
  });
}
