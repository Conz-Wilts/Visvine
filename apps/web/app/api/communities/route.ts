import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { handleApiError } from '@/lib/api/route';
import { provisionSpace } from '@/lib/spaces/provision';
import { isSpaceVisibility } from '@/lib/spaces/hierarchy';
import { resolveContext, principalOf } from '@/lib/notes/resolve';
import { writeDenial } from '@/lib/notes/contextService';
import { childSpaceNodeId, entityNotePath } from '@/lib/notes/entities';
import { slugify } from '@/lib/eventUtils';
import { recordChildSpace } from '@/lib/spaces/childRecord';

/**
 * POST /api/communities — user-facing space creation.
 *
 * Any signed-in user may create a brand-new top-level space and becomes its
 * admin. With `parentId` the space is created INSIDE that one (docs/sub-spaces.md):
 * the caller must be able to write the parent's `communities/` folder — the
 * same standing it takes to record an organisation there — and the new space
 * starts `inherit`, visible to the parent's members. (POST /api/data/communities
 * is the super-admin-only bulk path that trusts a client-supplied id.)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    if (session instanceof Response) return session;

    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const location = typeof body.location === 'string' ? body.location.trim() : '';
    const parentId = typeof body.parentId === 'string' && body.parentId ? body.parentId : null;
    // Private unless the caller explicitly says otherwise — a fresh space
    // shouldn't be discoverable before its creator has put anything in it.
    // A child left unsaid inherits (provisionSpace picks the default).
    const visibility = isSpaceVisibility(body.visibility) ? body.visibility : undefined;

    if (!name) {
      return NextResponse.json({ error: 'Space name is required' }, { status: 400 });
    }

    if (parentId) {
      const context = await resolveContext(session, parentId);
      if (context instanceof Response) return context;
      // Gate on the path the record will really take: a sub-space's note is a
      // folder at the ROOT of the parent's context, not a note in communities/
      // (lib/notes/entities.ts). createEntity re-checks it against the id that
      // wins; this is the early refusal, before a tenant is provisioned.
      const recordPath =
        entityNotePath({ id: childSpaceNodeId(slugify(name)), type: 'space' }) ?? '';
      const denied = writeDenial(await principalOf(context), context, recordPath);
      if (denied) return NextResponse.json({ error: denied }, { status: 403 });
    }

    const result = await provisionSpace({
      name,
      description,
      location,
      visibility,
      parentId,
      creator: { id: session.userId, name: session.name, email: session.email },
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error, ...(result.code ? { code: result.code } : {}) }, { status: result.status });
    }

    // Inside a parent, the new space is also a record of the parent's: the
    // `space` node + `communities/<slug>.md` every space node must have.
    if (parentId) {
      await recordChildSpace(parentId, result.space.id, name, session);
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
          parentId: s.parentId,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err, 'api.spaces.create.failed');
  }
}
