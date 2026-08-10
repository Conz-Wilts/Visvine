import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import prisma from '@/lib/prisma';
import { requireSession } from '@/lib/session';
import { slugify } from '@/lib/eventUtils';
import { handleApiError } from '@/lib/api/route';
import { OWNER_ALIAS_NAME } from '@/lib/types/context';
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
    const visibility = body.visibility === 'private' ? 'private' : 'public';

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

    const { community: created, space: defaultSpace } = await prisma.$transaction(async (tx) => {
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
      // Every community starts with a default space; admins can rename or delete it.
      const space = await tx.channelSpace.create({
        data: { communityId: id, name: 'General', position: 0 },
      });
      return { community, space };
    });

    // Access here is decided by aliases from the start, so there is nothing to
    // grandfather — without this, the first brain touch would hand a root grant
    // to every member and swamp the alias grants (lib/notes/access.ts).
    await markAccessSeeded(id);

    // Give the new community its place in its own context graph: a node for the
    // community, a node for its default space, and the containment edge between
    // them. Best-effort — a community that exists without context is recoverable
    // (the backfill script fixes it); a failed create is not.
    const actor = { id: session.userId, name: session.name, email: session.email };
    const communityNode = communityNodeId(id);
    await syncEntityNodeSafe({
      communityId: id,
      type: 'community',
      nodeId: communityNode,
      name,
      subtitle: description || null,
      location: location || null,
      body: description,
      actor,
    });
    await syncEntityNodeSafe({
      communityId: id,
      type: 'space',
      name: defaultSpace.name,
      recordId: defaultSpace.id,
      parentNodeId: communityNode,
      actor,
    });

    // Seed the brain's root index — the community's home page. The Directory's
    // Context tab routes to it, and falls back to the three-column browser for a
    // brain without one, so a community that never gets one never lands on its
    // own home page. Best-effort for the same reason as the context nodes above.
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
