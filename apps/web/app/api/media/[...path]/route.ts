import { NextRequest, NextResponse } from 'next/server';
import { readMediaObject } from '@/lib/gcs';
import { logger } from '@/lib/logger';

// Cache for 5 minutes — images can be re-uploaded so we need revalidation.
// The ?v= cache-buster on the URL handles immediate post-upload freshness.
const CACHE_MAX_AGE = 300;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  // Decode URI-encoded segments (e.g. person%3Afoo → person:foo) so the
  // object path matches what's stored in GCS.
  const objectPath = path.map(decodeURIComponent).join('/');

  try {
    const buffer = await readMediaObject(objectPath);
    if (!buffer) return new NextResponse(null, { status: 404 });

    // MEDIA_BUCKET stores only WebP variants — Content-Type is always image/webp.
    // Do not use this proxy for RESOURCES_BUCKET (mixed content types).
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/webp',
        'Content-Length': buffer.length.toString(),
        'Cache-Control': `public, max-age=${CACHE_MAX_AGE}, must-revalidate`,
      },
    });
  } catch (err: unknown) {
    const e = err as { code?: number; message?: string };
    if (e.code === 404) return new NextResponse(null, { status: 404 });
    logger.error('api.media.download.failed', {
      path: objectPath,
      code: e.code,
      message: e.message,
    });
    return new NextResponse(null, { status: 500 });
  }
}
