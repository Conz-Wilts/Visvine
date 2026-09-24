import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession, handleApiError, forbiddenResponse } from '@/lib/api/route';
import { directoryAccessForbidden, spaceMemberForbidden } from '@/lib/auth';
import { resourceViewer } from '@/lib/resources/visibility';
import { listResources } from '@/lib/resources/list';
import { parseListQuery } from '@/lib/resources/shared/listQuery';

export const runtime = 'nodejs';

/**
 * GET /api/spaces/<id>/resources?kind&channel&by&q&since&sort&trash&offset
 * — the space's resources the caller can see (lib/resources/list.ts): its
 * Resources view, a channel's Files tab (`channel`), the pickers.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ spaceId: string }> }) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    const { spaceId } = await context.params;
    if (await spaceMemberForbidden(session.userId, spaceId, session.email)) return forbiddenResponse();
    const query = parseListQuery(new URL(request.url).searchParams);
    // The space-wide list is the Directory's; a channel's Files are its members'.
    if (!query.channelId && (await directoryAccessForbidden(session.userId, spaceId, session.email))) {
      return forbiddenResponse();
    }
    const viewer = await resourceViewer(spaceId, session.userId, session.email);
    const page = await listResources(spaceId, viewer, query);
    return NextResponse.json(page);
  } catch (error) {
    return handleApiError(error, 'api.space.resources.failed');
  }
}
