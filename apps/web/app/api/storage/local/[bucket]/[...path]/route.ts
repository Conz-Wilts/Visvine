import { NextRequest, NextResponse } from 'next/server';
import { storageDriver } from '@/lib/gcs';
import { localRead, verifyLocalSignature } from '@/lib/storage/localStore';

// The local storage driver's signed-URL endpoint: what `getSignedUrl` hands
// back outside production resolves here. The URL itself is the credential —
// an HMAC over the bucket, path and expiry — so there is no session check,
// the same way a GCS signed URL is read by whoever holds it. 404 under any
// other driver: this path exists only where the files do.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ bucket: string; path: string[] }> },
) {
  if (storageDriver() !== 'local') return new NextResponse(null, { status: 404 });
  const { bucket, path } = await params;
  const objectPath = path.map(decodeURIComponent).join('/');
  const { searchParams } = req.nextUrl;
  if (!verifyLocalSignature(bucket, objectPath, searchParams.get('exp'), searchParams.get('sig'))) {
    return new NextResponse(null, { status: 403 });
  }
  const object = await localRead(bucket, objectPath);
  if (!object) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(object.bytes), {
    status: 200,
    headers: {
      'Content-Type': object.contentType,
      'Content-Length': object.bytes.length.toString(),
      'Cache-Control': 'private, max-age=300',
    },
  });
}
