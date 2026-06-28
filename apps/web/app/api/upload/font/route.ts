import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession as requireAdmin } from '@/lib/auth';
import { getStorage, MEDIA_BUCKET, getMediaUrl } from '@/lib/gcs';
import { logger } from '@/lib/logger';

const ALLOWED_EXTENSIONS = ['.woff2', '.ttf', '.otf'];
const ALLOWED_MIME_TYPES = [
  'font/woff2',
  'font/ttf',
  'font/otf',
  'application/font-woff2',
  'application/x-font-woff2',
  'application/font-ttf',
  'application/x-font-ttf',
  'application/font-otf',
  'application/x-font-opentype',
  'application/vnd.ms-opentype',
  'application/octet-stream', // browsers often send this for font files
];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

function getFormatFromExtension(filename: string): 'woff2' | 'truetype' | 'opentype' {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'woff2') return 'woff2';
  if (ext === 'ttf') return 'truetype';
  if (ext === 'otf') return 'opentype';
  return 'woff2';
}

function getMimeFromFormat(format: string): string {
  if (format === 'woff2') return 'font/woff2';
  if (format === 'truetype') return 'font/ttf';
  if (format === 'opentype') return 'font/otf';
  return 'application/octet-stream';
}

/**
 * POST /api/upload/font
 * Body: multipart form with fields: communityId, file, category ('main' | 'utility')
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const communityId = formData.get('communityId') as string | null;
    const category = formData.get('category') as string | null;

    if (!file || !communityId || !category) {
      return NextResponse.json({ error: 'file, communityId, and category are required' }, { status: 400 });
    }

    if (category !== 'main' && category !== 'utility') {
      return NextResponse.json({ error: 'category must be main or utility' }, { status: 400 });
    }

    const session = await requireAdmin(communityId);
    if (!session) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json({ error: 'Font must be .woff2, .ttf, or .otf' }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      // Allow through if extension is valid (browsers inconsistent with font MIME types)
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Font file must be less than 5MB' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const format = getFormatFromExtension(file.name);
    const objectPath = `communities/${communityId}/fonts/${category}${ext}`;

    const storage = getStorage();
    const bucket = storage.bucket(MEDIA_BUCKET());
    const gcsFile = bucket.file(objectPath);
    await gcsFile.save(buffer, { contentType: getMimeFromFormat(format) });

    const fontName = file.name.replace(/\.[^.]+$/, '');
    const url = getMediaUrl(objectPath);

    return NextResponse.json({ url, name: fontName, format }, { status: 201 });
  } catch (error) {
    logger.error('api.upload.font.failed', { err: error });
    return NextResponse.json({ error: 'Failed to upload font' }, { status: 500 });
  }
}
