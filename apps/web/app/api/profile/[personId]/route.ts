/**
 * Profile API — full profile data for a person node
 * GET  /api/profile/[personId]  → full profile for a person node
 * PATCH /api/profile/[personId] → update basic person fields (owner only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { normalizeImageUrl } from '@/lib/mediaUrl';

type RouteContext = { params: Promise<{ personId: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { personId } = await context.params;

  const person = await prisma.person.findUnique({
    where: { id: personId },
    include: {
      user: { select: { id: true } },
    },
  });

  if (!person) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  person.imageUrl = normalizeImageUrl(person.imageUrl) ?? person.imageUrl;

  return NextResponse.json(person, {
    headers: {
      'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
    },
  });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { personId } = await context.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify ownership
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { userId: true },
  });
  if (!person) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (person.userId !== session.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const {
    name, subtitle, bio, location, website, linkedinUrl, twitterUrl,
    phone, pronouns, openToWork, tags, imageUrl, metadata,
  } = body;

  const updated = await prisma.person.update({
    where: { id: personId },
    data: {
      ...(name !== undefined && { name }),
      ...(subtitle !== undefined && { subtitle }),
      ...(bio !== undefined && { bio }),
      ...(location !== undefined && { location }),
      ...(website !== undefined && { website }),
      ...(linkedinUrl !== undefined && { linkedinUrl }),
      ...(twitterUrl !== undefined && { twitterUrl }),
      ...(phone !== undefined && { phone }),
      ...(pronouns !== undefined && { pronouns }),
      ...(openToWork !== undefined && { openToWork }),
      ...(tags !== undefined && { tags }),
      ...(imageUrl !== undefined && { imageUrl }),
      ...(metadata !== undefined && { metadata }),
    },
  });

  // Sync shared fields back to the Node record so the graph/sidebar stay fresh.
  // Only update fields that are present in the patch to avoid clobbering unrelated data.
  const nodeUpdate: Record<string, unknown> = {};
  if (name !== undefined)     nodeUpdate.name     = name;
  if (subtitle !== undefined) nodeUpdate.subtitle = subtitle;
  if (location !== undefined) nodeUpdate.location = location;
  if (imageUrl !== undefined) nodeUpdate.imageUrl = imageUrl;
  if (tags !== undefined)     nodeUpdate.tags     = tags;

  if (Object.keys(nodeUpdate).length > 0) {
    await prisma.node.updateMany({
      where: { id: personId },
      data: nodeUpdate,
    });
    // Bust the graph cache so the sidebar picks up the new data on next load
    revalidateTag('graph-data-v2');
  }

  updated.imageUrl = normalizeImageUrl(updated.imageUrl) ?? updated.imageUrl;

  return NextResponse.json(updated);
}
