import { NextRequest, NextResponse } from 'next/server';
import { directoryAccessForbidden } from '@/lib/auth';
import { handleApiError, requireApiSession } from '@/lib/api/route';
import { searchNodes } from '@/lib/directory/search';

/**
 * GET /api/nodes/search?q=<query>&field=name|email&type=person|resource|event
 * Fuzzy-search nodes of a given type across all spaces (lib/directory/search.ts).
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;

    const q = req.nextUrl.searchParams.get('q')?.trim();
    const field = req.nextUrl.searchParams.get('field') || 'name';
    const type = req.nextUrl.searchParams.get('type') || 'person';
    // Optional. The link picker passes both: scope to one space and exclude
    // the source node + its existing neighbours so it can only ever offer a
    // valid new target.
    const spaceId = req.nextUrl.searchParams.get('space_id');
    const excludeIds = (req.nextUrl.searchParams.get('exclude_ids') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!q || q.length < 2) {
      return NextResponse.json({ results: [] });
    }

    // A space with an admins-only directory doesn't expose its nodes to
    // non-admin members through the picker either.
    if (spaceId && (await directoryAccessForbidden(session.userId, spaceId, session.email))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const results = await searchNodes(
      { q, field, type, spaceId, excludeIds },
      { userId: session.userId, email: session.email },
    );
    return NextResponse.json({ results });
  } catch (err) {
    return handleApiError(err, 'api.nodes.search.failed');
  }
}
