import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { handleApiError } from '@/lib/api/route';
import { provisionSpace } from '@/lib/spaces/provision';
import { isSpaceVisibility } from '@/lib/spaces/publicName';

/**
 * POST /api/communities — user-facing space creation.
 *
 * Any signed-in user may create a space and becomes its admin. Every space is a
 * tenant of its own: there is nothing to create it inside. (POST
 * /api/data/communities is the super-admin-only bulk path that trusts a
 * client-supplied id.)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    if (session instanceof Response) return session;

    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const location = typeof body.location === 'string' ? body.location.trim() : '';
    // Private unless the caller explicitly says otherwise — a fresh space
    // shouldn't be discoverable before its creator has put anything in it.
    const visibility = isSpaceVisibility(body.visibility) ? body.visibility : undefined;

    if (!name) {
      return NextResponse.json({ error: 'Space name is required' }, { status: 400 });
    }

    const result = await provisionSpace({
      name,
      description,
      location,
      visibility,
      creator: { id: session.userId, name: session.name, email: session.email },
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error, ...(result.code ? { code: result.code } : {}) }, { status: result.status });
    }

    const s = result.space;
    return NextResponse.json(
      {
        space: {
          id: s.id,
          name: s.name,
          description: s.description ?? '',
          location: s.location ?? undefined,
          tags: s.tags,
          memberCount: 1,
          createdAt: s.createdAt.toISOString(),
          visibility: s.visibility,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err, 'api.spaces.create.failed');
  }
}
