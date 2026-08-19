import { NextRequest, NextResponse } from 'next/server';
import { MEDIA_PREFIXES, mediaPrefixBare } from '@/lib/storage/objectPaths';
import { uploadProfileImage, deleteProfileImage, getMediaUrl } from '@/lib/gcs';
import { requireApiSession, handleApiError, forbiddenResponse } from '@/lib/api/route';
import { isAdmin, spaceMemberForbidden } from '@/lib/auth';
import type { SessionPayload } from '@/lib/session';
import prisma from '@/lib/prisma';
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

// GCS object prefixes. Two of them predate their type's rename ('persons',
// 'communities') and stay as they are: the prefix is part of the stored object
// path, so changing it would orphan every image already uploaded.
// The prefix table moved to lib/storage/objectPaths.ts — the one module that
// mints object paths, so a tenant purge and a reconciliation sweep can both
// reason about the layout instead of re-deriving it. `mediaPrefixBare` is the
// no-trailing-slash form these two helpers want (they append `/<variant>.webp`).
const ENTITY_PREFIXES = MEDIA_PREFIXES;

function buildPrefix(entityType: ImageEntityType, entityId: string): string {
  return mediaPrefixBare(entityType, entityId);
}

/**
 * Whether `session` may write/delete the image for (entityType, entityId).
 * Without this any signed-in user could overwrite or delete any tenant's logo,
 * avatar, card or event image — the id becomes the GCS prefix verbatim.
 *  - space: entityId IS a space id → require admin of it.
 *  - card | person | event: entityId is a node id → require active membership of
 *    the node's own space (the same audience that can edit that node).
 */
async function uploadForbidden(
  session: SessionPayload,
  entityType: ImageEntityType,
  entityId: string,
): Promise<boolean> {
  if (entityType === 'space') {
    return !(await isAdmin(session.userId, entityId, session.email));
  }
  const node = await prisma.node.findUnique({
    where: { id: entityId },
    select: { spaceId: true },
  });
  if (!node?.spaceId) return true; // unknown target → deny
  return spaceMemberForbidden(session.userId, node.spaceId, session.email);
}

/**
 * POST /api/upload
 * Body: multipart form with fields: entityType ('card'|'person'|'space'), entityId, file
 * Legacy: also accepts nodeId (treated as entityType=card)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;

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
      return NextResponse.json({ error: 'entityType must be card, person, space, or event' }, { status: 400 });
    }

    if (await uploadForbidden(session, entityType, entityId)) return forbiddenResponse();

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
    return handleApiError(error, 'api.upload.failed');
  }
}

/**
 * DELETE /api/upload?entityType=...&entityId=...
 * Legacy: also accepts ?nodeId=... (treated as entityType=card)
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;

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

    if (!Object.keys(ENTITY_PREFIXES).includes(entityType)) {
      return NextResponse.json({ error: 'entityType must be card, person, space, or event' }, { status: 400 });
    }

    if (await uploadForbidden(session, entityType, entityId)) return forbiddenResponse();

    await deleteProfileImage(buildPrefix(entityType, entityId));
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, 'api.upload.delete.failed');
  }
}
