import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession, handleApiError, ApiError } from '@/lib/api/route';
import { getSignedUrl, RESOURCES_BUCKET } from '@/lib/gcs';
import { requireVisibleResource } from '@/lib/resources/visibility';
import { logResourceAccess } from '@/lib/resources/accessLog';
import { contentDisposition } from '@/lib/resources/shared/disposition';

/** A signed URL lives five minutes; the redirect to it is cached for four. */
const SIGNED_MS = 5 * 60 * 1000;

/**
 * GET /api/resources/[resourceId]/raw — a resource's ORIGINAL bytes, for an
 * `<img>`, a player, a viewer, or (`?download=1`) a download under the file's
 * own name. Checks the reader against the resource's shares, then redirects to
 * a freshly signed URL; a rendition is never served from here, so saving what
 * this returns always saves the original.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ resourceId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  try {
    const { resourceId } = await params;
    const resource = await requireVisibleResource(resourceId, session.userId, session.email);
    if (!resource.gcsPath) throw new ApiError(404, 'This resource has no stored bytes');
    if (resource.scanState === 'blocked') throw new ApiError(403, 'This file was blocked by the scanner');
    const download = req.nextUrl.searchParams.get('download') === '1';
    const url = await getSignedUrl(RESOURCES_BUCKET(), resource.gcsPath, SIGNED_MS, {
      disposition: download ? contentDisposition(resource.name, 'attachment') : undefined,
    });
    if (download) {
      await logResourceAccess({
        resourceId: resource.id,
        spaceId: resource.spaceId,
        userId: session.userId,
        via: 'web',
        action: 'download',
      });
    }
    const res = NextResponse.redirect(new URL(url, req.url), 302);
    res.headers.set('Cache-Control', download ? 'no-store' : 'private, max-age=240');
    return res;
  } catch (error) {
    return handleApiError(error, 'resources.raw.failed');
  }
}
