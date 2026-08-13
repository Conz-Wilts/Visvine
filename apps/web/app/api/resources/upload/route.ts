import { NextRequest, NextResponse } from 'next/server';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { uploadResourceFile, RESOURCES_BUCKET, getSignedUrl } from '@/lib/gcs';
import { requireApiSession, forbiddenResponse } from '@/lib/api/route';
import { spaceMemberForbidden } from '@/lib/auth';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.tiff', '.heic', '.heif', '.ico']);
// Cap before buffering the whole body into memory + running sharp — an
// unbounded upload is a memory-DoS on a small Cloud Run instance.
const MAX_SIZE = 25 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const spaceId = formData.get('spaceId') as string | null;

  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ error: 'File must be less than 25MB' }, { status: 400 });
  // A space-scoped resource may only be uploaded by a member of that space.
  if (spaceId && (await spaceMemberForbidden(session.userId, spaceId, session.email))) {
    return forbiddenResponse();
  }

  const originalName = file.name;
  const ext = extname(originalName).toLowerCase();
  const uuid = randomUUID();
  const isImage = IMAGE_EXTS.has(ext);
  const finalExt = isImage ? '.webp' : ext;
  const filename = `${uuid}${finalExt}`;

  // Resources are scoped by space when spaceId is provided
  const objectPath = spaceId
    ? `resources/${spaceId}/${uuid}/${filename}`
    : `resources/unscoped/${uuid}/${filename}`;

  const buf = Buffer.from(await file.arrayBuffer());

  let uploadBuffer: Buffer;
  let contentType: string;

  if (isImage) {
    uploadBuffer = await sharp(buf)
      .rotate()
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
    contentType = 'image/webp';
  } else {
    uploadBuffer = buf;
    contentType = file.type || 'application/octet-stream';
  }

  await uploadResourceFile(objectPath, uploadBuffer, contentType);

  // Generate a signed URL (15 min) for immediate use; frontend should re-fetch via API when needed
  const fileUrl = await getSignedUrl(RESOURCES_BUCKET(), objectPath);

  const fileSize = buf.length;
  let fileType = 'pdf';
  if (isImage) fileType = 'image';
  else if (ext === '.xlsx' || ext === '.xls') fileType = 'xlsx';
  else if (ext === '.csv') fileType = 'csv';
  else if (ext === '.docx' || ext === '.doc') fileType = 'docx';

  return NextResponse.json({
    fileUrl,
    gcsPath: objectPath, // store this in DB — used for deletion and re-fetching signed URLs
    fileSize,
    fileType,
    originalFilename: originalName,
  });
}
