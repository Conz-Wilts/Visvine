/**
 * Profile sections API — the sections a member builds their own profile from.
 *
 * GET    /api/profile/[personId]/sections → { sections, isOwner }
 * POST   …  add a section          (owner only)
 * PATCH  …  rename, change kind, edit a text body, or reorder  (owner only)
 * DELETE …?id=<sectionId>          (owner only)
 *
 * What a kind is and what it holds lives in `lib/profile/shared/sections.ts`.
 * A section's rows are the sibling route. Every write answers with the whole
 * list.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { requireApiSession, forbiddenResponse, parseBody } from '@/lib/api/route';
import { resolveProfileUserId } from '@/lib/identity/connection';
import { listSections, nextSectionPosition, reorderSections } from '@/lib/profile/sections';
import { MAX_SECTIONS, MAX_TITLE, SECTION_KINDS, cleanTitle, fieldsFor, hasBody } from '@/lib/profile/shared/sections';

type RouteContext = { params: Promise<{ personId: string }> };

const kindSchema = z.enum(SECTION_KINDS.map((row) => row.kind) as [string, ...string[]]);

const createSchema = z.object({
  title: z.string().trim().max(MAX_TITLE).optional(),
  kind: kindSchema,
  body: z.string().max(20_000).nullish(),
});

const patchSchema = z.union([
  z.object({ order: z.array(z.string().min(1)).max(MAX_SECTIONS) }),
  z.object({
    id: z.string().min(1),
    title: z.string().trim().max(MAX_TITLE).optional(),
    kind: kindSchema.optional(),
    body: z.string().max(20_000).nullish(),
  }),
]);

/** The member behind the node, and whether the viewer is them. */
async function owner(personId: string, viewerId: string) {
  const userId = await resolveProfileUserId(personId);
  return { userId, isOwner: !!userId && userId === viewerId };
}

/** The owner's own sections, or a refusal. */
async function requireOwner(personId: string, viewerId: string) {
  const { userId, isOwner } = await owner(personId, viewerId);
  return userId && isOwner ? userId : null;
}

const answer = async (userId: string) =>
  NextResponse.json({ sections: await listSections(userId), isOwner: true });

export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { personId } = await context.params;
  const { userId, isOwner } = await owner(personId, session.userId);
  if (!userId) return NextResponse.json({ sections: [], isOwner: false });
  return NextResponse.json({ sections: await listSections(userId), isOwner });
}

export async function POST(req: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { personId } = await context.params;
  const userId = await requireOwner(personId, session.userId);
  if (!userId) return forbiddenResponse();

  const body = await parseBody(req, createSchema);
  if (body instanceof NextResponse) return body;

  const count = await prisma.profileSection.count({ where: { userId } });
  if (count >= MAX_SECTIONS) {
    return NextResponse.json({ error: `A profile holds at most ${MAX_SECTIONS} sections` }, { status: 400 });
  }

  await prisma.profileSection.create({
    data: {
      userId,
      title: cleanTitle(body.title ?? ''),
      kind: body.kind,
      body: hasBody(body.kind) ? (body.body ?? null) : null,
      position: await nextSectionPosition(userId),
    },
  });
  return answer(userId);
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { personId } = await context.params;
  const userId = await requireOwner(personId, session.userId);
  if (!userId) return forbiddenResponse();

  const body = await parseBody(req, patchSchema);
  if (body instanceof NextResponse) return body;

  if ('order' in body) {
    await reorderSections(userId, body.order);
    return answer(userId);
  }

  const section = await prisma.profileSection.findFirst({
    where: { id: body.id, userId }, select: { id: true, kind: true },
  });
  if (!section) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // A section that stops holding prose stops showing it; the kind decides.
  const kind = body.kind ?? section.kind;
  // A section that changes shape takes its rows with it: what the new kind
  // does not draw is cleared, not left under the surface to come back.
  if (body.kind && body.kind !== section.kind) {
    const drawn = new Set<string>(fieldsFor(body.kind));
    const cleared = Object.fromEntries(
      (['title', 'subtitle', 'description', 'url', 'startYear', 'endYear'] as const)
        .filter((field) => !drawn.has(field))
        .map((field) => [field, null]),
    );
    if (Object.keys(cleared).length > 0) {
      await prisma.profileSectionEntry.updateMany({ where: { sectionId: section.id }, data: cleared });
    }
  }
  await prisma.profileSection.update({
    where: { id: section.id },
    data: {
      ...(body.title !== undefined ? { title: cleanTitle(body.title) } : {}),
      ...(body.kind !== undefined ? { kind: body.kind } : {}),
      ...(body.body !== undefined || body.kind !== undefined
        ? { body: hasBody(kind) ? (body.body ?? null) : null }
        : {}),
    },
  });
  return answer(userId);
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { personId } = await context.params;
  const userId = await requireOwner(personId, session.userId);
  if (!userId) return forbiddenResponse();

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  await prisma.profileSection.deleteMany({ where: { id, userId } });
  return answer(userId);
}
