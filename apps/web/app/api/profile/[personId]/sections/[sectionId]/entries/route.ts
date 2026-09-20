/**
 * The rows of one profile section.
 *
 * POST   /api/profile/[personId]/sections/[sectionId]/entries → add a row
 * PATCH  …  edit a row, or reorder with { order: [...] }
 * DELETE …?id=<entryId>
 *
 * Owner only, like the section itself. A row keeps only the fields its
 * section's kind draws (`normalizeEntry`), and may point only at a space the
 * owner actually belongs to (`ownedSpaceId`). Every write answers with the
 * whole section list, the same shape the sections route returns.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { requireApiSession, forbiddenResponse, parseBody } from '@/lib/api/route';
import { resolveProfileUserId } from '@/lib/identity/connection';
import { listSections, nextEntryPosition, ownedSpaceId, reorderEntries } from '@/lib/profile/sections';
import { MAX_ENTRIES, normalizeEntry } from '@/lib/profile/shared/sections';

type RouteContext = { params: Promise<{ personId: string; sectionId: string }> };

const year = z.string().trim().regex(/^\d{4}$/, 'Use a four-digit year').nullish();
const entryShape = {
  title: z.string().trim().max(200).nullish(),
  subtitle: z.string().trim().max(200).nullish(),
  description: z.string().trim().max(2000).nullish(),
  url: z.string().trim().max(2000).nullish(),
  startYear: year,
  endYear: year,
  imageUrl: z.string().trim().max(2000).nullish(),
  spaceId: z.string().trim().max(200).nullish(),
};
const createSchema = z.object(entryShape);
const patchSchema = z.union([
  z.object({ order: z.array(z.string().min(1)).max(MAX_ENTRIES) }),
  z.object({ id: z.string().min(1), ...entryShape }),
]);

/** The section, when it is this viewer's own to edit. */
async function ownSection(personId: string, sectionId: string, viewerId: string) {
  const userId = await resolveProfileUserId(personId);
  if (!userId || userId !== viewerId) return null;
  const section = await prisma.profileSection.findFirst({
    where: { id: sectionId, userId }, select: { id: true, kind: true },
  });
  return section ? { userId, section } : null;
}

const answer = async (userId: string) =>
  NextResponse.json({ sections: await listSections(userId), isOwner: true });

export async function POST(req: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { personId, sectionId } = await context.params;
  const own = await ownSection(personId, sectionId, session.userId);
  if (!own) return forbiddenResponse();

  const body = await parseBody(req, createSchema);
  if (body instanceof NextResponse) return body;

  const count = await prisma.profileSectionEntry.count({ where: { sectionId } });
  if (count >= MAX_ENTRIES) {
    return NextResponse.json({ error: `A section holds at most ${MAX_ENTRIES} rows` }, { status: 400 });
  }

  const values = normalizeEntry(own.section.kind, body);
  await prisma.profileSectionEntry.create({
    data: {
      ...values,
      spaceId: await ownedSpaceId(own.userId, values.spaceId),
      sectionId,
      position: await nextEntryPosition(sectionId),
    },
  });
  return answer(own.userId);
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { personId, sectionId } = await context.params;
  const own = await ownSection(personId, sectionId, session.userId);
  if (!own) return forbiddenResponse();

  const body = await parseBody(req, patchSchema);
  if (body instanceof NextResponse) return body;

  if ('order' in body) {
    await reorderEntries(sectionId, body.order);
    return answer(own.userId);
  }

  const { id, ...patch } = body;
  const values = normalizeEntry(own.section.kind, patch);
  const { count } = await prisma.profileSectionEntry.updateMany({
    where: { id, sectionId },
    data: {
      ...values,
      ...('spaceId' in values ? { spaceId: await ownedSpaceId(own.userId, values.spaceId) } : {}),
    },
  });
  if (count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return answer(own.userId);
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { personId, sectionId } = await context.params;
  const own = await ownSection(personId, sectionId, session.userId);
  if (!own) return forbiddenResponse();

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  await prisma.profileSectionEntry.deleteMany({ where: { id, sectionId } });
  return answer(own.userId);
}
