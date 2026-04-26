import { NextRequest, NextResponse } from 'next/server';
import { uploadProfileImage, deleteProfileImage, getMediaUrl } from '@/lib/gcs';
import { requireSession } from '@/lib/session';
import type { ImageEntityType } from '@/lib/imageUpload';
import { logger } from '@/lib/logger';

const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/tiff',
  'image/bmp',
  'image/heic',
  'image/heif',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/x-ms-bmp',
  'image/x-portable-pixmap',
  'image/x-portable-graymap',
  'image/x-portable-bitmap',
  'image/x-portable-anymap',
];

const MAX_SIZE = 10 * 1024 * 1024;

const ENTITY_PREFIXES: Record<ImageEntityType, string> = {
  card:      'cards',
  person:    'persons',
  community: 'communities',
};

function buildPrefix(entityType: ImageEntityType, entityId: string): string {
  return `${ENTITY_PREFIXES[entityType]}/${entityId}`;
}

/**
 * POST /api/upload
 * Body: multipart form with fields: entityType ('card'|'person'|'community'), entityId, file
 * Legacy: also accepts nodeId (treated as entityType=card)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    if (session instanceof Response) return session;

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    // Support new entityType/entityId params and legacy nodeId
    let entityType = formData.get('entityType') as ImageEntityType | null;
    let entityId   = formData.get('entityId') as string | null;
    const nodeId   = formData.get('nodeId') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }

    if (!entityType || !entityId) {
      if (nodeId) {
        entityType = 'card';
        entityId   = nodeId;
      } else {
        return NextResponse.json({ error: 'entityType and entityId are required' }, { status: 400 });
      }
    }

    if (!Object.keys(ENTITY_PREFIXES).includes(entityType)) {
      return NextResponse.json({ error: 'entityType must be card, person, or community' }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Unsupported image format. Please upload a valid image file (JPEG, PNG, GIF, WebP, TIFF, BMP, HEIC, SVG, etc.)' },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Image must be less than 10MB' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const prefix = buildPrefix(entityType, entityId);

    logger.info('api.upload.started', { entityType, entityId, prefix, fileName: file.name, fileSize: file.size });

    try {
      await uploadProfileImage(prefix, buffer);
      logger.info('api.upload.gcs_ok', { prefix });
    } catch (sharpError) {
      logger.error('api.upload.image_processing.failed', { err: sharpError });
      return NextResponse.json(
        { error: 'Failed to process image. The file may be corrupted or in an unsupported format.' },
        { status: 400 }
      );
    }

    const baseUrl = getMediaUrl(`${prefix}/avatar-lg.webp`);
    const url     = `${baseUrl}?v=${Date.now()}`;
    const gcsPath = prefix;

    return NextResponse.json({ url, gcsPath, baseUrl }, { status: 201 });
  } catch (error) {
    logger.error('api.upload.failed', { err: error });
    return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 });
  }
}

/**
 * DELETE /api/upload?entityType=...&entityId=...
 * Legacy: also accepts ?nodeId=... (treated as entityType=card)
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await requireSession();
    if (session instanceof Response) return session;

    const { searchParams } = new URL(request.url);

    let entityType = searchParams.get('entityType') as ImageEntityType | null;
    let entityId   = searchParams.get('entityId');
    const nodeId   = searchParams.get('nodeId');

    if (!entityType || !entityId) {
      if (nodeId) {
        entityType = 'card';
        entityId   = nodeId;
      } else {
        return NextResponse.json({ error: 'entityType and entityId are required' }, { status: 400 });
      }
    }

    await deleteProfileImage(buildPrefix(entityType, entityId));
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('api.upload.delete.failed', { err: error });
    return NextResponse.json({ error: 'Failed to delete image' }, { status: 500 });
  }
}
