import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession, handleApiError, ApiError } from '@/lib/api/route';
import { requireVisibleResource } from '@/lib/resources/visibility';
import { readResourceText } from '@/lib/resources/text';

/**
 * GET /api/resources/[resourceId]/text?offset=&max= — a page of the text
 * extracted from a file (a deck's slides, a PDF's pages), read through the
 * caller's context lens like any note under the resource's folder.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ resourceId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    const { resourceId } = await params;
    const gate = await requireVisibleResource(resourceId, session.userId, session.email);
    const offset = Number(req.nextUrl.searchParams.get('offset') ?? 0) || 0;
    const max = Math.min(Number(req.nextUrl.searchParams.get('max') ?? 20_000) || 20_000, 100_000);
    const page = await readResourceText(session, gate.spaceId, gate.id, { offsetChars: offset, maxChars: max });
    if (!page) throw new ApiError(404, 'This file has no text');
    return NextResponse.json(page);
  } catch (err) {
    return handleApiError(err, 'resources.text');
  }
}
