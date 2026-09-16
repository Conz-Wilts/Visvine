import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { handleApiError } from '@/lib/api/route';
import { provisionSpace } from '@/lib/spaces/provision';
import { isSpaceVisibility } from '@/lib/spaces/publicName';
import { descriptionDenial } from '@/lib/spaces/shared/description';
import { isAdmin } from '@/lib/auth';
import { DOORS, LISTINGS, type Door, type Listing } from '@/lib/spaces/subspaces';

/**
 * POST /api/spaces — user-facing space creation.
 *
 * Any signed-in user may create a space and becomes its admin. With `parentId`
 * the space is a SUB-SPACE of that one (docs/sub-spaces.md) — an act of the
 * parent's admins, since it puts a space under theirs; the creator is the
 * sub-space's admin from then on, whoever they are to the parent. (POST
 * /api/data/spaces is the super-admin-only bulk path that trusts a
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
    const parentId = typeof body.parentId === 'string' && body.parentId.trim() ? body.parentId.trim() : null;
    // A room's dials (docs/sub-spaces.md): a preset fills them, explicit
    // values win, and provisionSpace defaults the rest. Only read for a room.
    const preset = typeof body.preset === 'string' ? body.preset : null;
    const listing = LISTINGS.includes(body.listing) ? (body.listing as Listing) : undefined;
    const houseDoor = DOORS.includes(body.houseDoor) ? (body.houseDoor as Door) : undefined;
    const worldDoor = DOORS.includes(body.worldDoor) ? (body.worldDoor as Door) : undefined;
    const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);

    if (!name) {
      return NextResponse.json({ error: 'Space name is required' }, { status: 400 });
    }
    const descriptionError = descriptionDenial(description);
    if (descriptionError) return NextResponse.json({ error: descriptionError }, { status: 400 });
    if (parentId && !(await isAdmin(session.userId, parentId, session.email))) {
      return NextResponse.json({ error: 'Only an admin of the space can create a sub-space inside it' }, { status: 403 });
    }

    const result = await provisionSpace({
      name,
      description,
      location,
      visibility,
      parentId,
      ...(parentId
        ? {
            preset,
            listing,
            houseDoor,
            worldDoor,
            flowContext: bool(body.flowContext),
            flowEvents: bool(body.flowEvents),
            flowPeople: bool(body.flowPeople),
            parentAdmins: bool(body.parentAdmins),
          }
        : {}),
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
          parentId: s.parentId,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err, 'api.spaces.create.failed');
  }
}
