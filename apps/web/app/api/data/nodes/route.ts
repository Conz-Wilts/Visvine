import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import prisma from '@/lib/prisma';
import { getSession, isAdmin, spaceMemberForbidden, directoryAccessForbidden } from '@/lib/auth';
import type { NBNode } from '@/lib/types';
import { normalizeImageUrl } from '@/lib/mediaUrl';
import { handleApiError, requireApiSession } from '@/lib/api/route';
import { attachIdentity } from '@/lib/identity/attachIdentity';
import { ensureEntityNote } from '@/lib/notes/context/entityNodes';

function nodeRowToNBNode(row: {
  id: string; type: string; name: string; alias: string | null; subtitle: string | null;
  location: string | null; url: string | null; imageUrl: string | null;
  tags: string[]; metadata: unknown; spaceId: string | null; createdAt: Date;
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
    space_id: row.spaceId ?? null,
    // Pre-rename spelling, still decoded by shipped mobile builds. Emitted
    // alongside space_id rather than instead of it; drop once they roll over.
    community_id: row.spaceId ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * GET: Fetch all nodes for a space
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    // `community_id` is the pre-rename spelling shipped mobile builds send.
    const spaceId = searchParams.get('space_id') ?? searchParams.get('community_id');

    if (!spaceId) {
      return NextResponse.json({ error: 'space_id is required' }, { status: 400 });
    }

    // The whole node directory is space-scoped confidential data: only an
    // active member (or admin) may pull it, and never across tenants by passing
    // a foreign `space_id`. `directoryAccessForbidden` additionally honours
    // the admins-only-directory setting for members.
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    if (
      (await spaceMemberForbidden(session.userId, spaceId, session.email)) ||
      (await directoryAccessForbidden(session.userId, spaceId, session.email))
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const rows = await prisma.node.findMany({
      where: { spaceId },
      select: { id: true, type: true, name: true, alias: true, subtitle: true, location: true, url: true, imageUrl: true, tags: true, metadata: true, spaceId: true, createdAt: true },
      orderBy: { name: 'asc' },
    });

    const nodes: NBNode[] = rows.map(nodeRowToNBNode);
    return NextResponse.json({ nodes });
  } catch (err) {
    return handleApiError(err, 'api.data.nodes.get.failed');
  }
}

/**
 * POST: Create a new node
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { node, space_id, identity_id } = body as {
      node: NBNode;
      space_id: string;
      // Optional: an identity the user explicitly picked from the quick-add finder.
      // An explicit human choice is trusted (and recorded as 'confirmed'); without
      // it the server resolves the identity itself — the client can never silently
      // force a merge.
      identity_id?: string | null;
    };

    if (!space_id) {
      return NextResponse.json({ error: 'space_id is required' }, { status: 400 });
    }

    if (!node.id || !node.type || !node.name) {
      return NextResponse.json({ error: 'Node must have id, type, and name' }, { status: 400 });
    }

    const session = await getSession();
    const userIsAdmin = session ? await isAdmin(session.userId, space_id, session.email) : false;

    if (!userIsAdmin) {
      return NextResponse.json({ error: 'Admin access required to create nodes' }, { status: 403 });
    }

    // ── Resolve the canonical cross-space identity (people/orgs only) ──
    const { identityId, resolution } = await attachIdentity(node, {
      identityId: identity_id,
      actorUserId: session?.userId ?? null,
    });

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
        spaceId: space_id,
        identityId,
      },
    });

    // Every node gets its canonical context note, including ones added from the
    // admin Data tab — otherwise the same person exists in the graph but not in
    // the context depending on which surface created them.
    await ensureEntityNote(
      space_id,
      { id: row.id, type: row.type, name: row.name, subtitle: row.subtitle },
      {
        tags: row.tags,
        actor: session ? { id: session.userId, name: session.name, email: session.email } : null,
      },
    );

    revalidateTag('context-data-v2', { expire: 0 });
    // `resolution` lets the client surface possible-match suggestions (Tier C) for
    // inline confirmation; null when the type has no identity or an explicit pick won.
    return NextResponse.json({ node: nodeRowToNBNode(row), resolution }, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'api.data.nodes.post.failed');
  }
}

/**
 * PUT: Update an existing node
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { node, space_id } = body as { node: NBNode; space_id: string };

    if (!space_id || !node.id) {
      return NextResponse.json({ error: 'space_id and node.id are required' }, { status: 400 });
    }

    if (!node.type || !node.name) {
      return NextResponse.json({ error: 'Node must have type and name' }, { status: 400 });
    }

    const session = await getSession();
    if (!session || !(await isAdmin(session.userId, space_id, session.email))) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const existing = await prisma.node.findFirst({ where: { id: node.id, spaceId: space_id } });
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

    revalidateTag('context-data-v2', { expire: 0 });
    return NextResponse.json({ node: nodeRowToNBNode(row) });
  } catch (err) {
    return handleApiError(err, 'api.data.nodes.put.failed');
  }
}

/**
 * DELETE: Delete a node (links cascade via FK)
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const spaceId = searchParams.get('space_id');

    if (!id || !spaceId) {
      return NextResponse.json({ error: 'id and space_id are required' }, { status: 400 });
    }

    const session = await getSession();
    if (!session || !(await isAdmin(session.userId, spaceId, session.email))) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    await prisma.node.deleteMany({ where: { id, spaceId } });

    revalidateTag('context-data-v2', { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err, 'api.data.nodes.delete.failed');
  }
}
