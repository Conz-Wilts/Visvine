import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import prisma from '@/lib/prisma';
import { getSession, isAdmin, spaceMemberForbidden, directoryAccessForbidden } from '@/lib/auth';
import { upsertLink, removeLink } from '@/lib/notes/context/links';
import type { NBLink } from '@/lib/types';
import { handleApiError, requireApiSession } from '@/lib/api/route';

/**
 * GET: Fetch all links for a space
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const spaceId = searchParams.get('space_id');

    if (!spaceId) {
      return NextResponse.json({ error: 'space_id is required' }, { status: 400 });
    }

    // A space's relationship graph is confidential and member-scoped — only
    // an active member/admin may read it, never across tenants via a foreign
    // `space_id`.
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    if (
      (await spaceMemberForbidden(session.userId, spaceId, session.email)) ||
      (await directoryAccessForbidden(session.userId, spaceId, session.email))
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const data = await prisma.link.findMany({
      where: { spaceId },
      select: { id: true, sourceId: true, targetId: true, relationship: true, since: true, metadata: true, spaceId: true, origin: true },
    });

    const links = data.map(l => ({
      id: l.id,
      source: l.sourceId,
      target: l.targetId,
      relationship: l.relationship,
      since: l.since,
      metadata: l.metadata,
      space_id: l.spaceId,
      origin: l.origin,
    }));

    return NextResponse.json({ links });
  } catch (err) {
    return handleApiError(err, 'api.data.links.get.failed');
  }
}

/**
 * POST: Create a new link
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { link, space_id } = body as {
      link: NBLink & { source: string; target: string };
      space_id: string;
    };

    if (!space_id) {
      return NextResponse.json({ error: 'space_id is required' }, { status: 400 });
    }

    if (!link.source || !link.target) {
      return NextResponse.json({ error: 'Link must have source and target' }, { status: 400 });
    }

    const session = await getSession();
    const userIsAdmin = session ? await isAdmin(session.userId, space_id, session.email) : false;

    if (!userIsAdmin) {
      return NextResponse.json({ error: 'Admin access required to create links' }, { status: 403 });
    }

    const created = await upsertLink({
      spaceId: space_id,
      sourceId: link.source,
      targetId: link.target,
      relationship: link.relationship || 'related', // geometry-only drag defaults to "related"
      origin: 'manual',
      createdBy: session?.userId ?? null,
      since: link.since ?? null,
      metadata: link.metadata,
    });

    revalidateTag('context-data-v2', { expire: 0 });
    return NextResponse.json({
      link: {
        id: created.id,
        source: created.sourceId,
        target: created.targetId,
        relationship: created.relationship,
        since: created.since,
        metadata: created.metadata,
        space_id: created.spaceId,
        origin: created.origin,
      },
    }, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'api.data.links.post.failed');
  }
}

/**
 * PUT: Update an existing link
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { link, space_id, originalSource, originalTarget } = body as {
      link: NBLink & { source: string; target: string };
      space_id: string;
      originalSource: string;
      originalTarget: string;
    };

    if (!space_id || !originalSource || !originalTarget) {
      return NextResponse.json({ error: 'space_id, originalSource, and originalTarget are required' }, { status: 400 });
    }

    if (!link.source || !link.target || !link.relationship) {
      return NextResponse.json({ error: 'Link must have source, target, and relationship' }, { status: 400 });
    }

    const session = await getSession();
    if (!session || !(await isAdmin(session.userId, space_id, session.email))) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const existing = await prisma.link.findFirst({
      where: { sourceId: originalSource, targetId: originalTarget, spaceId: space_id },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Link not found' }, { status: 404 });
    }

    const updated = await prisma.link.update({
      where: { id: existing.id },
      data: {
        sourceId: link.source,
        targetId: link.target,
        relationship: link.relationship,
        since: link.since ?? null,
        metadata: (link.metadata as object) ?? {},
      },
    });

    revalidateTag('context-data-v2', { expire: 0 });
    return NextResponse.json({
      link: {
        source: updated.sourceId,
        target: updated.targetId,
        relationship: updated.relationship,
        since: updated.since,
        metadata: updated.metadata,
        space_id: updated.spaceId,
      },
    });
  } catch (err) {
    return handleApiError(err, 'api.data.links.put.failed');
  }
}

/**
 * DELETE: Delete a link
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get('source_id');
    const targetId = searchParams.get('target_id');
    const spaceId = searchParams.get('space_id');
    const relationship = searchParams.get('relationship') ?? undefined;

    if (!sourceId || !targetId || !spaceId) {
      return NextResponse.json({ error: 'source_id, target_id, and space_id are required' }, { status: 400 });
    }

    const session = await getSession();
    if (!session || !(await isAdmin(session.userId, spaceId, session.email))) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Undirected delete (matches the stored edge regardless of source/target order).
    // Admins may remove any edge regardless of origin (auto edges included). An optional
    // ?relationship= narrows the delete to one edge type between the pair.
    await removeLink(spaceId, sourceId, targetId, relationship);

    revalidateTag('context-data-v2', { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err, 'api.data.links.delete.failed');
  }
}
