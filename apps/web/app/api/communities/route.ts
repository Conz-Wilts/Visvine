import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import prisma from '@/lib/prisma';
import { requireSession } from '@/lib/session';
import { slugify } from '@/lib/eventUtils';
import { handleApiError } from '@/lib/api/route';
import { OWNER_ALIAS_NAME } from '@/lib/types/context';
import { ALL_FEATURE_KEYS, CORE_FEATURE_KEYS } from '@/lib/featureAccess';
import { markAccessSeeded } from '@/lib/notes/access';
import { findPublicNameConflict, publicNameTakenMessage } from '@/lib/communities/publicName';
import { ensureMemberNode } from '@/lib/communities/memberNode';
import { ensureRootIndex, SHARED_OWNER_KEY } from '@/lib/notes/store';
import { logger } from '@/lib/logger';

/**
 * POST /api/communities — user-facing community creation.
 *
 * Any signed-in user may create a brand-new top-level community and becomes its
 * admin. (This is distinct from POST /api/data/communities, the super-admin-only
 * bulk-create path that trusts a client-supplied id.) The server derives the id
 * from the name and guarantees uniqueness, so a caller can't collide with or
 * hijack an existing community.
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
      return NextResponse.json({ error: 'Community name is required' }, { status: 400 });
    }

    // Only public names have to be unique — the default private create can be
    // called anything (lib/communities/publicName.ts).
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
    const base = slugify(name) || 'community';
    let id = base;
    for (let n = 2; await prisma.community.findUnique({ where: { id }, select: { id: true } }); n++) {
      id = `${base}-${n}`;
    }

    const created = await prisma.$transaction(async (tx) => {
      const community = await tx.community.create({
        data: {
          id,
          name,
          description,
          location: location || null,
          visibility,
          memberCount: 1,
          dataFile: `${id}.json`,
          inviteToken: randomUUID(),
          // Only the Directory tool to begin with — every toggleable tool starts
          // off and the admin opts in from the console. (Core keys — directory,
          // notes, events — are always on and never persisted here.)
          featureConfig: {
            enabled: Object.fromEntries(
              ALL_FEATURE_KEYS.filter((key) => !CORE_FEATURE_KEYS.includes(key)).map((key) => [key, false])
            ),
          },
        },
      });
      await tx.userCommunity.create({
        data: { userId: session.userId, communityId: id, status: 'active' },
      });
      // Every community's Person aliases start with the built-in Owner one
      // (the communityAliases column default). The creator holds it — otherwise
      // nobody could ever manage the community (lib/auth.ts#isAdmin).
      await tx.userAlias.create({
        data: {
          communityId: id,
          userId: session.userId,
          aliasName: OWNER_ALIAS_NAME,
          addedBy: session.userId,
        },
      });
      return community;
    });

    // Access here is decided by aliases from the start, so there is nothing to
    // grandfather — without this, the first brain touch would hand a root grant
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
    // Owner alias, matching the UserAlias row written above, so the card reads
    // "Owner" rather than a bare "Person"; and it is connected to their account
    // through the identity bridge (ensureMemberNode), which is what makes it
    // their profile rather than a loose card with their name on it. It stays
    // node-only: the Context tab stubs a missing profile note locally and the
    // first real save creates it. Best-effort — a member without a node is
    // recoverable (the backfill script fixes it); a failed create is not.
    const actor = { id: session.userId, name: session.name, email: session.email };
    await ensureMemberNode(id, session.userId, actor, OWNER_ALIAS_NAME);

    // Seed the brain's root index — the community's home page, which the
    // Directory's Context tab routes to. Best-effort for the same reason as
    // the context node above.
    try {
      await ensureRootIndex({ communityId: id, ownerKey: SHARED_OWNER_KEY }, name, actor);
    } catch (err) {
      logger.warn('communities.root_index_failed', { communityId: id, err });
    }

    return NextResponse.json(
      {
        community: {
          id: created.id,
          name: created.name,
          description: created.description ?? '',
          location: created.location ?? undefined,
          tags: created.tags,
          memberCount: created.memberCount,
          createdAt: created.createdAt.toISOString(),
          visibility: created.visibility,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err, 'api.communities.create.failed');
  }
}
