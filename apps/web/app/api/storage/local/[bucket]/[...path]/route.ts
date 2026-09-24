import { NextRequest, NextResponse } from 'next/server';
import { storageDriver } from '@/lib/gcs';
import { localRead, verifyLocalSignature } from '@/lib/storage/localStore';

// The local storage driver's signed-URL endpoint: what `getSignedUrl` hands
// back outside production resolves here. The URL itself is the credential —
// an HMAC over the bucket, path, expiry and any disposition — so there is no
// session check, the same way a GCS signed URL is read by whoever holds it.
// Byte ranges are answered as GCS answers them, so a video seeks in dev too.
// 404 under any other driver: this path exists only where the files do.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ bucket: string; path: string[] }> },
) {
  if (storageDriver() !== 'local') return new NextResponse(null, { status: 404 });
  const { bucket, path } = await params;
  const objectPath = path.map(decodeURIComponent).join('/');
  const { searchParams } = req.nextUrl;
  const disposition = searchParams.get('cd');
  if (!verifyLocalSignature(bucket, objectPath, searchParams.get('exp'), searchParams.get('sig'), disposition)) {
    return new NextResponse(null, { status: 403 });
  }
  const object = await localRead(bucket, objectPath);
  if (!object) return new NextResponse(null, { status: 404 });

  const total = object.bytes.length;
  const headers: Record<string, string> = {
    'Content-Type': object.contentType,
    'Cache-Control': 'private, max-age=300',
    'Accept-Ranges': 'bytes',
  };
  if (disposition) headers['Content-Disposition'] = disposition;

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
    if (start >= total || start > end) {
      return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
    }
    const slice = object.bytes.subarray(start, end + 1);
    return new NextResponse(new Uint8Array(slice), {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': String(slice.length) },
    });
  }
  return new NextResponse(new Uint8Array(object.bytes), {
    status: 200,
    headers: { ...headers, 'Content-Length': String(total) },
  });
}
