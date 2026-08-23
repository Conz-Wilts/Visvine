import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import prisma from '@/lib/prisma';
import { requireSession } from '@/lib/session';
import { slugify } from '@/lib/eventUtils';
import { handleApiError } from '@/lib/api/route';
import { ADMIN_ALIAS_ID, ADMIN_ALIAS_NAME } from '@/lib/types/context';
import { defaultFeatureConfig } from '@/lib/featureAccess';
import { markAccessSeeded } from '@/lib/notes/access';
import { findPublicNameConflict, publicNameTakenMessage } from '@/lib/spaces/publicName';
import { ensureMemberNode } from '@/lib/spaces/memberNode';
import { isReservedSpaceId } from '@/lib/spaces/globalSpace';
import { ensureRootIndex, SHARED_OWNER_KEY } from '@/lib/notes/store';
import { logger } from '@/lib/logger';

/**
 * POST /api/communities — user-facing space creation.
 *
 * Any signed-in user may create a brand-new top-level space and becomes its
 * admin. (This is distinct from POST /api/data/communities, the super-admin-only
 * bulk-create path that trusts a client-supplied id.) The server derives the id
 * from the name and guarantees uniqueness, so a caller can't collide with or
 * hijack an existing space.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    if (session instanceof Response) return session;

    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const location = typeof body.location === 'string' ? body.location.trim() : '';
    // Private unless the caller explicitly opts into public — a fresh space
    // shouldn't be discoverable before its creator has put anything in it.
    const visibility = body.visibility === 'public' ? 'public' : 'private';

    if (!name) {
      return NextResponse.json({ error: 'Space name is required' }, { status: 400 });
    }

    // Only public names have to be unique — the default private create can be
    // called anything (lib/spaces/publicName.ts).
    if (visibility === 'public') {
      const clash = await findPublicNameConflict(name);
      if (clash) {
        return NextResponse.json(
          { error: publicNameTakenMessage(clash.name), code: 'name_taken' },
          { status: 409 }
        );
      }
    }

    // Derive a unique id from the name. slugify never yields "me:"-prefixed ids,
    // so this can't collide with a personal-space id.
    const base = slugify(name) || 'space';
    let id = isReservedSpaceId(base) ? `${base}-2` : base;
    for (let n = 2; await prisma.space.findUnique({ where: { id }, select: { id: true } }); n++) {
      id = `${base}-${n}`;
    }

    const created = await prisma.$transaction(async (tx) => {
      const space = await tx.space.create({
        data: {
          id,
          name,
          description,
          location: location || null,
          visibility,
          inviteToken: randomUUID(),
          // Most toggleable tools start off, opted in from the console — except
          // the DEFAULT_ON set (Tools: the marketplace and community-built
          // Tools are on from day one). Core keys — directory, notes, events —
          // are always on and never persisted here.
          featureConfig: defaultFeatureConfig() as object,
        },
      });
      await tx.spaceMember.create({
        data: { userId: session.userId, spaceId: id, status: 'active' },
      });
      // Every space's Person aliases start with the built-in Admin one
      // (the aliases column default). The creator holds it — otherwise
      // nobody could ever manage the space (lib/auth.ts#isAdmin).
      await tx.userAlias.create({
        data: {
          spaceId: id,
          userId: session.userId,
          aliasId: ADMIN_ALIAS_ID,
          addedBy: session.userId,
        },
      });
      return space;
    });

    // Access here is decided by aliases from the start, so there is nothing to
    // grandfather — without this, the first context touch would hand a root grant
    // to every member and swamp the alias grants (lib/notes/access.ts).
    await markAccessSeeded(id);

    // A new space deliberately gets NO node for itself: it would put a card for
    // the space in its own directory and a `communities/<slug>.md` page in its
    // own context, neither of which anyone asked for — the space IS the
    // container, not an entity inside it. Structural code already copes with the
    // missing `community:<id>` node: syncEntityNode skips a parent edge whose
    // node doesn't exist, and reparentEntityNode does the same. A space created
    // by hand from the Directory (lib/directory/createEntity.ts) still gets one.
    //
    // So the creator's person node is the ONLY node a fresh space starts with —
    // the first member belongs in the directory they just made. It carries the
    // Admin alias, matching the UserAlias row written above, so the card reads
    // "Admin" rather than a bare "Person"; and it is connected to their account
    // through the identity bridge (ensureMemberNode), which is what makes it
    // their profile rather than a loose card with their name on it. It stays
    // node-only: the Context tab stubs a missing profile note locally and the
    // first real save creates it. Best-effort — a member without a node is
    // recoverable (the backfill script fixes it); a failed create is not.
    const actor = { id: session.userId, name: session.name, email: session.email };
    await ensureMemberNode(id, session.userId, actor, ADMIN_ALIAS_NAME);

    // Seed the context's root index — the space's home page, which the
    // Directory's Context tab routes to. Best-effort for the same reason as
    // the context node above.
    try {
      await ensureRootIndex({ spaceId: id, ownerKey: SHARED_OWNER_KEY }, name, actor);
    } catch (err) {
      logger.warn('spaces.root_index_failed', { spaceId: id, err });
    }

    return NextResponse.json(
      {
        space: {
          id: created.id,
          name: created.name,
          description: created.description ?? '',
          location: created.location ?? undefined,
          tags: created.tags,
          memberCount: 1,
          createdAt: created.createdAt.toISOString(),
          visibility: created.visibility,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err, 'api.spaces.create.failed');
  }
}
