import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession, handleApiError, ApiError } from '@/lib/api/route';
import { requireVisibleResource } from '@/lib/resources/visibility';
import { savePoster } from '@/lib/resources/renditions';

const MAX_POSTER_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/resources/[resourceId]/poster — a frame of a video, sent by the
 * browser that uploaded it (it decoded the video already; the server has no
 * ffmpeg). Only the uploader may set it; the pixels are re-encoded like any
 * image and only ever drawn as this video's thumbnail.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ resourceId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    const { resourceId } = await params;
    const resource = await requireVisibleResource(resourceId, session.userId, session.email);
    if (resource.createdBy !== session.userId) throw new ApiError(403, 'Only the uploader sets a poster');
    if (resource.kind !== 'video') throw new ApiError(400, 'Only a video has a poster');
    const bytes = Buffer.from(await req.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_POSTER_BYTES) throw new ApiError(400, 'A poster is an image under 5 MB');
    await savePoster(resource, bytes);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err, 'resources.poster');
  }
}
