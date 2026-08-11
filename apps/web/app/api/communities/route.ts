import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import prisma from '@/lib/prisma';
import { requireSession } from '@/lib/session';
import { slugify } from '@/lib/eventUtils';
import { handleApiError } from '@/lib/api/route';
import { OWNER_ALIAS_NAME } from '@/lib/types/context';
import { ALL_FEATURE_KEYS, CORE_FEATURE_KEYS } from '@/lib/featureAccess';
import { markAccessSeeded } from '@/lib/notes/access';
import { communityNodeId, syncEntityNodeSafe } from '@/lib/notes/context/entityNodes';
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

    // Give the new space its place in its own context graph: a node for the
    // space itself, and a person node for the creator — the first member
    // belongs in the directory they just made. Nodes only — seeding canonical
    // notes here would plant communities/ and people/ folders in an
    // otherwise-empty brain; the Context tab stubs a missing note locally and
    // the first real save creates it. Best-effort — a space that exists
    // without context is recoverable (the backfill script fixes it); a failed
    // create is not.
    const actor = { id: session.userId, name: session.name, email: session.email };
    await syncEntityNodeSafe({
      communityId: id,
      type: 'space',
      nodeId: communityNodeId(id),
      name,
      subtitle: description || null,
      location: location || null,
      skipNote: true,
      actor,
    });
    // The Person row (created at the auth callback, edited from the profile
    // editor) is the source of truth for the creator's profile fields. Its own
    // node (id = Person.id) lives in their personal space, so this community
    // gets a per-community person node, keyed to the user via metadata.userId.
    const person = await prisma.person.findUnique({
      where: { userId: session.userId },
      select: { name: true, subtitle: true, location: true, imageUrl: true, tags: true },
    });
    await syncEntityNodeSafe({
      communityId: id,
      type: 'person',
      name: person?.name?.trim() || session.name,
      recordId: session.userId,
      subtitle: person?.subtitle ?? null,
      location: person?.location ?? null,
      imageUrl: person?.imageUrl ?? null,
      tags: person?.tags ?? [],
      skipNote: true,
      actor,
    });

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
