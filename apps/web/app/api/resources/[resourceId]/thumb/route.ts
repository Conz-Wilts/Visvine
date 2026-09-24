import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiSession, handleApiError, ApiError } from '@/lib/api/route';
import { getSignedUrl, RESOURCES_BUCKET } from '@/lib/gcs';
import { requireVisibleResource } from '@/lib/resources/visibility';

const KINDS = new Set(['thumb', 'preview', 'poster', 'page1']);
const SIGNED_MS = 5 * 60 * 1000;

/**
 * GET /api/resources/[resourceId]/thumb?kind=thumb|preview|poster|page1 — one
 * of the images derived from a resource (lib/resources/renditions.ts): a
 * file's rendition, or a link's re-hosted page image. 404 when it has none,
 * which a grid answers with the file's icon. Never the original — that is
 * `/raw`.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ resourceId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    const { resourceId } = await params;
    const kind = req.nextUrl.searchParams.get('kind') ?? 'thumb';
    if (!KINDS.has(kind)) throw new ApiError(400, 'Unknown rendition');
    const resource = await requireVisibleResource(resourceId, session.userId, session.email);
    const rendition = await prisma.resourceRendition.findUnique({
      where: { resourceId_kind: { resourceId: resource.id, kind } },
      select: { gcsPath: true },
    });
    const fallback = kind === 'thumb' || kind === 'preview' ? await linkImagePath(resource.id) : null;
    const path = rendition?.gcsPath ?? fallback;
    if (!path) throw new ApiError(404, 'No such image');
    const url = await getSignedUrl(RESOURCES_BUCKET(), path, SIGNED_MS);
    const res = NextResponse.redirect(new URL(url, req.url), 302);
    res.headers.set('Cache-Control', 'private, max-age=240');
    return res;
  } catch (err) {
    return handleApiError(err, 'resources.thumb');
  }
}

/** A link's page image, re-hosted by the unfurler. */
async function linkImagePath(resourceId: string): Promise<string | null> {
  const row = await prisma.resource.findUnique({ where: { id: resourceId }, select: { previewPath: true } });
  return row?.previewPath ?? null;
}
