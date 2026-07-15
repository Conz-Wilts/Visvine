import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import prisma from '@/lib/prisma';
import { requireSession, isSuperAdmin } from '@/lib/session';
import { isAdmin } from '@/lib/auth';
import type { Community, CommunityAlias } from '@/lib/types';
import { handleApiError } from '@/lib/api/route';

/**
 * GET: Fetch all communities
 */
export async function GET() {
  try {
    const session = await requireSession();
    if (session instanceof Response) return session;

    const superAdmin = isSuperAdmin(session.email);

    const data = await prisma.community.findMany({
      // Visibility rules (super-admins see everything):
      //  - Personal spaces (personalOwnerId set) are private to their owner.
      //  - Private communities (visibility 'private') are hidden from Discover /
      //    other users' lists unless the user is already an active member.
      //  - Public communities are visible to everyone.
      where: superAdmin
        ? undefined
        : {
            AND: [
              // Not someone else's personal space.
              {
                OR: [
                  { personalOwnerId: null },
                  { personalOwnerId: session.userId },
                ],
              },
              // Public, or the caller is an active member of it.
              {
                OR: [
                  { visibility: 'public' },
                  { personalOwnerId: session.userId },
                  {
                    userCommunities: {
                      some: { userId: session.userId, status: 'active' },
                    },
                  },
                ],
              },
            ],
          },
      select: {
        id: true,
        name: true,
        description: true,
        country: true,
        location: true,
        tags: true,
        memberCount: true,
        createdAt: true,
        imageUrl: true,
        communityAliases: true,
        linkTypes: true,
        designConfig: true,
        featureConfig: true,
        visibility: true,
      },
      orderBy: { name: 'asc' },
    });

    // Prisma returns camelCase fields already via @map
    const communities: Community[] = data.map(c => ({
      id: c.id,
      name: c.name,
      description: c.description ?? '',
      country: c.country ?? undefined,
      location: c.location ?? undefined,
      tags: c.tags ?? [],
      memberCount: c.memberCount,
      dataFile: '',
      createdAt: c.createdAt.toISOString(),
      imageUrl: c.imageUrl ?? undefined,
      nodeTypes: undefined as unknown as Community['nodeTypes'],
      communityAliases: (c.communityAliases as unknown as CommunityAlias[]) ?? [],
      linkTypes: (c.linkTypes as unknown) as Community['linkTypes'],
      designConfig: (c.designConfig as unknown as Community['designConfig']) ?? undefined,
      featureConfig: (c.featureConfig as unknown as Community['featureConfig']) ?? undefined,
      visibility: (c.visibility as 'public' | 'private') ?? 'public',
    }));

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
        communityAliases: community.communityAliases as object ?? [],
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

    revalidateTag('graph-data');
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

    // Check if community has nodes or links
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
