import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import prisma from '@/lib/prisma';
import { getSession, isAdmin } from '@/lib/auth';
import type { NBLink } from '@/lib/types';
import { logger } from '@/lib/logger';

/**
 * GET: Fetch all links for a community
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const communityId = searchParams.get('community_id');

    if (!communityId) {
      return NextResponse.json({ error: 'community_id is required' }, { status: 400 });
    }

    const data = await prisma.link.findMany({
      where: { communityId },
      select: { id: true, sourceId: true, targetId: true, relationship: true, since: true, metadata: true, communityId: true },
    });

    const links = data.map(l => ({
      source: l.sourceId,
      target: l.targetId,
      relationship: l.relationship,
      since: l.since,
      metadata: l.metadata,
      community_id: l.communityId,
    }));

    return NextResponse.json({ links });
  } catch (err) {
    logger.error('api.data.links.get.failed', { err });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST: Create a new link
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { link, community_id } = body as {
      link: NBLink & { source: string; target: string };
      community_id: string;
    };

    if (!community_id) {
      return NextResponse.json({ error: 'community_id is required' }, { status: 400 });
    }

    if (!link.source || !link.target || !link.relationship) {
      return NextResponse.json({ error: 'Link must have source, target, and relationship' }, { status: 400 });
    }

    const session = await getSession();
    const userIsAdmin = session ? await isAdmin(session.userId, community_id, session.email) : false;

    if (!userIsAdmin) {
      // TODO: Implement content submission approval workflow
      // For now, non-admins cannot create links
      return NextResponse.json({ error: 'Admin access required to create links' }, { status: 403 });
    }

    const created = await prisma.link.create({
      data: {
        sourceId: link.source,
        targetId: link.target,
        relationship: link.relationship,
        since: link.since ?? null,
        metadata: (link.metadata as object) ?? {},
        communityId: community_id,
      },
    });

    revalidateTag('graph-data-v2');
    return NextResponse.json({
      link: {
        source: created.sourceId,
        target: created.targetId,
        relationship: created.relationship,
        since: created.since,
        metadata: created.metadata,
        community_id: created.communityId,
      },
    }, { status: 201 });
  } catch (err) {
    logger.error('api.data.links.post.failed', { err });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT: Update an existing link
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { link, community_id, originalSource, originalTarget } = body as {
      link: NBLink & { source: string; target: string };
      community_id: string;
      originalSource: string;
      originalTarget: string;
    };

    if (!community_id || !originalSource || !originalTarget) {
      return NextResponse.json({ error: 'community_id, originalSource, and originalTarget are required' }, { status: 400 });
    }

    if (!link.source || !link.target || !link.relationship) {
      return NextResponse.json({ error: 'Link must have source, target, and relationship' }, { status: 400 });
    }

    const session = await getSession();
    if (!session || !(await isAdmin(session.userId, community_id, session.email))) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const existing = await prisma.link.findFirst({
      where: { sourceId: originalSource, targetId: originalTarget, communityId: community_id },
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

    revalidateTag('graph-data-v2');
    return NextResponse.json({
      link: {
        source: updated.sourceId,
        target: updated.targetId,
        relationship: updated.relationship,
        since: updated.since,
        metadata: updated.metadata,
        community_id: updated.communityId,
      },
    });
  } catch (err) {
    logger.error('api.data.links.put.failed', { err });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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
    const communityId = searchParams.get('community_id');

    if (!sourceId || !targetId || !communityId) {
      return NextResponse.json({ error: 'source_id, target_id, and community_id are required' }, { status: 400 });
    }

    const session = await getSession();
    if (!session || !(await isAdmin(session.userId, communityId, session.email))) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    await prisma.link.deleteMany({
      where: { sourceId, targetId, communityId },
    });

    revalidateTag('graph-data-v2');
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('api.data.links.delete.failed', { err });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
