import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import prisma from '@/lib/prisma';
import { getSession, isAdmin } from '@/lib/auth';
import type { NBNode } from '@/lib/types';
import { normalizeImageUrl } from '@/lib/mediaUrl';
import { logger } from '@/lib/logger';

function nodeRowToNBNode(row: {
  id: string; type: string; name: string; alias: string | null; subtitle: string | null;
  location: string | null; url: string | null; imageUrl: string | null;
  tags: string[]; metadata: unknown; communityId: string | null; createdAt: Date;
}): NBNode {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    alias: row.alias ?? null,
    subtitle: row.subtitle ?? null,
    location: row.location ?? null,
    url: row.url ?? null,
    image_url: normalizeImageUrl(row.imageUrl),
    tags: row.tags,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    community_id: row.communityId ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * GET: Fetch all nodes for a community
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const communityId = searchParams.get('community_id');

    if (!communityId) {
      return NextResponse.json({ error: 'community_id is required' }, { status: 400 });
    }

    const rows = await prisma.node.findMany({
      where: { communityId },
      select: { id: true, type: true, name: true, alias: true, subtitle: true, location: true, url: true, imageUrl: true, tags: true, metadata: true, communityId: true, createdAt: true },
      orderBy: { name: 'asc' },
    });

    const nodes: NBNode[] = rows.map(nodeRowToNBNode);
    return NextResponse.json({ nodes });
  } catch (err) {
    logger.error('api.data.nodes.get.failed', { err });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST: Create a new node
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { node, community_id } = body as { node: NBNode; community_id: string };

    if (!community_id) {
      return NextResponse.json({ error: 'community_id is required' }, { status: 400 });
    }

    if (!node.id || !node.type || !node.name) {
      return NextResponse.json({ error: 'Node must have id, type, and name' }, { status: 400 });
    }

    const session = await getSession();
    const userIsAdmin = session ? await isAdmin(session.userId, community_id, session.email) : false;

    if (!userIsAdmin) {
      // TODO: Implement content submission approval workflow
      // For now, non-admins cannot create nodes
      return NextResponse.json({ error: 'Admin access required to create nodes' }, { status: 403 });
    }

    const row = await prisma.node.create({
      data: {
        id: node.id,
        // Node type is stored lowercase-canonical (eventRepo and mention lookups
        // filter on exact lowercase, e.g. type='event'); rendering resolves it
        // case-insensitively via getNodeTypeConfig.
        type: node.type.toLowerCase(),
        name: node.name,
        subtitle: node.subtitle ?? null,
        location: node.location ?? null,
        url: node.url ?? null,
        imageUrl: node.image_url ?? null,
        tags: node.tags ?? [],
        metadata: (node.metadata as object) ?? {},
        communityId: community_id,
      },
    });

    revalidateTag('graph-data-v2');
    return NextResponse.json({ node: nodeRowToNBNode(row) }, { status: 201 });
  } catch (err) {
    logger.error('api.data.nodes.post.failed', { err });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT: Update an existing node
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { node, community_id } = body as { node: NBNode; community_id: string };

    if (!community_id || !node.id) {
      return NextResponse.json({ error: 'community_id and node.id are required' }, { status: 400 });
    }

    if (!node.type || !node.name) {
      return NextResponse.json({ error: 'Node must have type and name' }, { status: 400 });
    }

    const session = await getSession();
    if (!session || !(await isAdmin(session.userId, community_id, session.email))) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const existing = await prisma.node.findFirst({ where: { id: node.id, communityId: community_id } });
    if (!existing) return NextResponse.json({ error: 'Node not found' }, { status: 404 });

    // Build update data — only include fields that are explicitly present in the
    // request body so we don't accidentally null out fields that were stripped by
    // JSON.stringify (undefined values are omitted by JSON.stringify).
    const data: Record<string, unknown> = {
      type: node.type.toLowerCase(),
      name: node.name,
      tags: node.tags ?? [],
      metadata: (node.metadata as object) ?? {},
    };
    if ('subtitle' in node)  data.subtitle = node.subtitle ?? null;
    if ('location' in node)  data.location = node.location ?? null;
    if ('url' in node)       data.url = node.url ?? null;
    if ('image_url' in node) data.imageUrl = node.image_url ?? null;

    const row = await prisma.node.update({
      where: { id: node.id },
      data,
    });

    // Keep Person.imageUrl in sync when a person node's image changes
    if ('image_url' in node && node.id.startsWith('person:')) {
      await prisma.person.updateMany({
        where: { id: node.id },
        data: { imageUrl: node.image_url ?? null },
      });
    }

    revalidateTag('graph-data-v2');
    return NextResponse.json({ node: nodeRowToNBNode(row) });
  } catch (err) {
    logger.error('api.data.nodes.put.failed', { err });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE: Delete a node (links cascade via FK)
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const communityId = searchParams.get('community_id');

    if (!id || !communityId) {
      return NextResponse.json({ error: 'id and community_id are required' }, { status: 400 });
    }

    const session = await getSession();
    if (!session || !(await isAdmin(session.userId, communityId, session.email))) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    await prisma.node.deleteMany({ where: { id, communityId } });

    revalidateTag('graph-data-v2');
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('api.data.nodes.delete.failed', { err });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
