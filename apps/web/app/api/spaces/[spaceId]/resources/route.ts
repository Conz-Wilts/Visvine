import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession, handleApiError, forbiddenResponse } from '@/lib/api/route';
import { spaceMemberForbidden, directoryAccessForbidden } from '@/lib/auth';
import { listLibrary } from '@/lib/resources/library';
import { isLibraryFilter } from '@/lib/resources/shared/library';

export const runtime = 'nodejs';

/**
 * GET /api/spaces/<id>/resources?filter=all|files|links&q=&before=
 * The Resources tab: every file and link the space holds, newest first, one
 * page at a time (`nextBefore`). Gated like the Directory it sits in.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ spaceId: string }> }) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    const { spaceId } = await context.params;
    const [memberForbidden, featureForbidden] = await Promise.all([
      spaceMemberForbidden(session.userId, spaceId, session.email),
      directoryAccessForbidden(session.userId, spaceId, session.email),
    ]);
    if (memberForbidden || featureForbidden) return forbiddenResponse();

    const params = new URL(request.url).searchParams;
    const filterParam = params.get('filter');
    const page = await listLibrary(
      spaceId,
      { userId: session.userId, email: session.email },
      {
        filter: isLibraryFilter(filterParam) ? filterParam : 'all',
        q: params.get('q')?.slice(0, 200) ?? undefined,
        before: params.get('before'),
      },
    );
    return NextResponse.json(page);
  } catch (error) {
    return handleApiError(error, 'api.space.resources.failed');
  }
}
