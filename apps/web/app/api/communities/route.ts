import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import prisma from '@/lib/prisma';
import { requireSession } from '@/lib/session';
import { slugify } from '@/lib/eventUtils';
import { handleApiError } from '@/lib/api/route';

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
        },
      });
      // Creator becomes admin of their own community.
      await tx.userCommunity.create({
        data: { userId: session.userId, communityId: id, role: 'admin', status: 'active' },
      });
      return community;
    });

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
