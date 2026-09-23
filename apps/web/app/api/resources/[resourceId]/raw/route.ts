import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession, handleApiError } from '@/lib/api/route';
import { getSignedUrl, RESOURCES_BUCKET } from '@/lib/gcs';
import { requireReadableResource } from '@/lib/resources/access';

/**
 * GET /api/resources/[resourceId]/raw — a Drive file's bytes, for an `<img>` in
 * a message or a row in Resources. Checks the reader, then redirects to a
 * freshly signed URL; the redirect is cached privately for less than the
 * signature lives, so a page of thumbnails is not a page of signings.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ resourceId: string }> },
) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  try {
    const { resourceId } = await params;
    const resource = await requireReadableResource(resourceId, session.userId, session.email);
    if (!resource.gcsPath || !process.env.GCS_RESOURCES_BUCKET) {
      return NextResponse.json({ error: 'This file has no stored bytes' }, { status: 404 });
    }
    const url = await getSignedUrl(RESOURCES_BUCKET(), resource.gcsPath);
    const res = NextResponse.redirect(new URL(url, _req.url), 302);
    res.headers.set('Cache-Control', 'private, max-age=600');
    return res;
  } catch (error) {
    return handleApiError(error, 'resources.raw.failed');
  }
}
