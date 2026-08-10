import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import prisma from '@/lib/prisma';
import { requireSession, isSuperAdmin } from '@/lib/session';
import { isAdmin } from '@/lib/auth';
import type { Community, CommunityAlias } from '@/lib/types';
import { handleApiError } from '@/lib/api/route';
import { listVisibleCommunities } from '@/lib/communities/queries';
import { reconcilePersonAliases } from '@/lib/notes/aliases';

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
      },
    });

    // Every community starts with a default space; admins can rename or delete it.
    await prisma.channelSpace.create({
      data: { communityId: created.id, name: 'General', position: 0 },
    });

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

    const [nodeCount, linkCount] = await Promise.all([
      prisma.node.count({ where: { communityId: id } }),
      prisma.link.count({ where: { communityId: id } }),
    ]);

    if (nodeCount + linkCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete community with existing nodes or connections. Delete them first.' },
        { status: 400 }
      );
    }

    await prisma.community.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err, 'api.data.communities.delete.failed');
  }
}
