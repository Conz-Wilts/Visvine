import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession, handleApiError } from '@/lib/api/route';
import { receiveLocalChunk } from '@/lib/resources/upload';

/**
 * PUT /api/resources/uploads/[uploadId] — the local storage driver's stand-in
 * for a GCS resumable session, speaking its protocol: a chunk carries
 * `Content-Range: bytes a-b/total`, `bytes *\/total` asks how much arrived,
 * and the reply is 308 with `Range: bytes=0-n` until the last byte, then 200.
 * 404 under the GCS driver, where the browser talks to the bucket.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ uploadId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    const { uploadId } = await params;
    const body = Buffer.from(await req.arrayBuffer());
    const { complete, received } = await receiveLocalChunk(uploadId, session.userId, req.headers.get('content-range'), body);
    if (complete) return new NextResponse(null, { status: 200 });
    const headers: Record<string, string> = {};
    if (received > 0) headers.Range = `bytes=0-${received - 1}`;
    return new NextResponse(null, { status: 308, headers });
  } catch (err) {
    return handleApiError(err, 'resources.uploads.chunk');
  }
}
