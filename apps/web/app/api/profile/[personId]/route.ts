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

  if (person) {
    person.imageUrl = normalizeImageUrl(person.imageUrl) ?? person.imageUrl;

    return NextResponse.json(person, {
      headers: {
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
      },
    });
  }

  // No Person row yet. Many person nodes are created graph-first (seed scripts,
  // CRM imports, bulk adds) and only get a Person row when someone edits the
  // profile. Rather than 404, synthesize a profile from the graph Node so the
  // page still renders. Only person: nodes are profiles.
  if (personId.startsWith('person:')) {
    const node = await prisma.node.findUnique({ where: { id: personId } });
    if (node) {
      const meta = (node.metadata ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
      const synthesized = {
        id: node.id,
        communityId: node.communityId,
        name: node.name,
        subtitle: node.subtitle ?? null,
        bio: str(meta.bio),
        location: node.location ?? null,
        website: str(meta.website) ?? node.url ?? null,
        linkedinUrl: str(meta.linkedinUrl),
        twitterUrl: str(meta.twitterUrl),
        phone: str(meta.phone),
        pronouns: str(meta.pronouns),
        email: null,
        imageUrl: normalizeImageUrl(node.imageUrl) ?? node.imageUrl ?? null,
        tags: node.tags ?? [],
        metadata: meta,
        userId: null,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
      };
      return NextResponse.json(synthesized, {
        headers: {
          'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
        },
      });
    }
  }

  return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
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
    phone, pronouns, tags, imageUrl, metadata,
  } = body;

  // Sync shared fields back to the Node record so the graph/sidebar stay fresh.
  // Only update fields that are present in the patch to avoid clobbering unrelated data.
  const nodeUpdate: Record<string, unknown> = {};
  if (name !== undefined)     nodeUpdate.name     = name;
  if (subtitle !== undefined) nodeUpdate.subtitle = subtitle;
  if (location !== undefined) nodeUpdate.location = location;
  if (imageUrl !== undefined) nodeUpdate.imageUrl = imageUrl;
  if (tags !== undefined)     nodeUpdate.tags     = tags;

  // Write the Person row and its graph Node in one transaction so a mid-sequence
  // failure can't leave them diverged.
  const hasNodeUpdate = Object.keys(nodeUpdate).length > 0;
  const [updated] = await prisma.$transaction([
    prisma.person.update({
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
        ...(tags !== undefined && { tags }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(metadata !== undefined && { metadata }),
      },
    }),
    ...(hasNodeUpdate
      ? [prisma.node.updateMany({ where: { id: personId }, data: nodeUpdate })]
      : []),
  ]);

  if (hasNodeUpdate) {
    // Bust the graph cache so the sidebar picks up the new data on next load
    revalidateTag('graph-data-v2');
  }

  updated.imageUrl = normalizeImageUrl(updated.imageUrl) ?? updated.imageUrl;

  return NextResponse.json(updated);
}
