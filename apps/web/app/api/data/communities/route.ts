import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import prisma from '@/lib/prisma';
import { requireSession, isSuperAdmin } from '@/lib/session';
import { isAdmin } from '@/lib/auth';
import type { Community, CommunityAlias } from '@/lib/types';
import { handleApiError } from '@/lib/api/route';
import { listVisibleCommunities } from '@/lib/communities/queries';
import { ALL_FEATURE_KEYS, CORE_FEATURE_KEYS } from '@/lib/featureAccess';
import { reconcilePersonAliases } from '@/lib/notes/aliases';
import { ensureRootIndex, SHARED_OWNER_KEY } from '@/lib/notes/store';
import { logger } from '@/lib/logger';

/**
 * GET: Fetch all communities
 */
export async function GET() {
  try {
    const session = await requireSession();
    if (session instanceof Response) return session;

    const communities = await listVisibleCommunities(session);

    return NextResponse.json(
      { communities },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
        },
      }
    );
  } catch (err) {
    return handleApiError(err, 'api.data.communities.get.failed');
  }
}

/**
 * POST: Create a new community
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    if (session instanceof Response) return session;
    if (!isSuperAdmin(session.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { community } = body as { community: Partial<Community> };

    if (!community.id || !community.name) {
      return NextResponse.json(
        { error: 'Community must have id and name' },
        { status: 400 }
      );
    }

    const created = await prisma.community.create({
      data: {
        id: community.id,
        name: community.name,
        description: community.description || '',
        location: community.location ?? null,
        tags: community.tags || [],
        memberCount: community.memberCount || 0,
        dataFile: community.dataFile || `${community.id}.json`,
        imageUrl: community.imageUrl ?? null,
        nodeTypes: community.nodeTypes as object ?? null,
        communityAliases: community.communityAliases as object ?? [],
        // Same defaults as the user-facing create: private, Directory only.
        visibility: community.visibility === 'public' ? 'public' : 'private',
        featureConfig: {
          enabled: Object.fromEntries(
            ALL_FEATURE_KEYS.filter((key) => !CORE_FEATURE_KEYS.includes(key)).map((key) => [key, false])
          ),
        },
      },
    });

    // Seed the brain's root index — the community's home page, which the
    // Directory's Context tab routes to. Best-effort: never fail the create
    // over it.
    try {
      await ensureRootIndex(
        { communityId: created.id, ownerKey: SHARED_OWNER_KEY },
        created.name,
        { id: session.userId, name: session.name, email: session.email }
      );
    } catch (err) {
      logger.warn('data.communities.root_index_failed', { communityId: created.id, err });
    }

    const createdCommunity: Community = {
      id: created.id,
      name: created.name,
      description: created.description ?? '',
      location: created.location ?? undefined,
      tags: created.tags,
      memberCount: created.memberCount,
      dataFile: created.dataFile ?? '',
      createdAt: created.createdAt.toISOString(),
      imageUrl: created.imageUrl ?? undefined,
      nodeTypes: (created.nodeTypes as unknown) as Community['nodeTypes'],
      communityAliases: (created.communityAliases as unknown as CommunityAlias[]) ?? [],
    };

    return NextResponse.json({ community: createdCommunity }, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'api.data.communities.post.failed');
  }
}

/**
 * PUT: Update an existing community
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await requireSession();
    if (session instanceof Response) return session;

    const body = await request.json();
    const { community } = body as { community: Community };

    // Must be admin of the community or super-admin
    if (!isSuperAdmin(session.email) && community.id && !(await isAdmin(session.userId, community.id, session.email))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!community.id) {
      return NextResponse.json(
        { error: 'community.id is required' },
        { status: 400 }
      );
    }

    if (!community.name) {
      return NextResponse.json(
        { error: 'Community must have name' },
        { status: 400 }
      );
    }

    // Person aliases ARE the permission model, so a save here can strip one
    // that people hold and grants point at. Reconcile first: it refuses if the
    // community would be left with nobody owning it, drops the holders and
    // grants of every alias that disappeared, and returns the list to store —
    // with the `owner` flags carried over, since this page cannot edit them.
    let personAliasesToStore: CommunityAlias[];
    try {
      personAliasesToStore = await reconcilePersonAliases(
        community.id,
        ((community.communityAliases ?? []) as unknown as CommunityAlias[]),
      );
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
    const otherAliases = ((community.communityAliases ?? []) as unknown as CommunityAlias[])
      .filter((a) => a.nodeType?.toLowerCase() !== 'person');

    const updated = await prisma.community.update({
      where: { id: community.id },
      data: {
        name: community.name,
        description: community.description,
        location: community.location ?? null,
        tags: community.tags,
        memberCount: community.memberCount,
        dataFile: community.dataFile,
        imageUrl: community.imageUrl ?? null,
        nodeTypes: community.nodeTypes as object ?? null,
        communityAliases: [...otherAliases, ...personAliasesToStore] as unknown as object,
        linkTypes: community.linkTypes as object ?? null,
      },
    });

    const updatedCommunity: Community = {
      id: updated.id,
      name: updated.name,
      description: updated.description ?? '',
      location: updated.location ?? undefined,
      tags: updated.tags,
      memberCount: updated.memberCount,
      dataFile: updated.dataFile ?? '',
      createdAt: updated.createdAt.toISOString(),
      imageUrl: updated.imageUrl ?? undefined,
      nodeTypes: (updated.nodeTypes as unknown) as Community['nodeTypes'],
      communityAliases: (updated.communityAliases as unknown as CommunityAlias[]) ?? [],
      linkTypes: (updated.linkTypes as unknown) as Community['linkTypes'],
    };

    revalidateTag('context-data', { expire: 0 });
    return NextResponse.json({ community: updatedCommunity });
  } catch (err) {
    return handleApiError(err, 'api.data.communities.put.failed');
  }
}

/**
 * DELETE: Delete a community
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await requireSession();
    if (session instanceof Response) return session;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'id is required' },
        { status: 400 }
      );
    }

    // Must be admin of the community or super-admin
    if (!isSuperAdmin(session.email) && !(await isAdmin(session.userId, id, session.email))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const exists = await prisma.community.findUnique({ where: { id }, select: { id: true } });
    if (!exists) {
      return NextResponse.json({ error: 'Community not found' }, { status: 404 });
    }

    // Deleting the community cascades through every FK-backed relation (nodes,
    // links, notes, members, channels, grants…). These tables carry a
    // communityId without a foreign key, so they must be swept by hand or
    // they'd survive as orphans.
    await prisma.$transaction([
      prisma.post.deleteMany({ where: { communityId: id } }),
      prisma.resource.deleteMany({ where: { communityId: id } }),
      prisma.privateColumn.deleteMany({ where: { communityId: id } }),
      prisma.communityColumn.deleteMany({ where: { communityId: id } }),
      prisma.communityColumnRequest.deleteMany({ where: { communityId: id } }),
      prisma.valueShareRequest.deleteMany({ where: { communityId: id } }),
      prisma.auditLog.deleteMany({ where: { communityId: id } }),
      prisma.community.delete({ where: { id } }),
    ]);

    revalidateTag('context-data', { expire: 0 });

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err, 'api.data.communities.delete.failed');
  }
}
