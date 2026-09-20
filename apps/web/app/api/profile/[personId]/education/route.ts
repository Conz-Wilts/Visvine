/**
 * Education API — the schools on a member's profile.
 *
 * GET    /api/profile/[personId]/education → { education, isOwner }
 * POST   /api/profile/[personId]/education → add one (owner only)
 * PATCH  /api/profile/[personId]/education → edit one by id (owner only)
 * DELETE /api/profile/[personId]/education?id=… → remove one (owner only)
 *
 * These are rows, not note frontmatter: a profile fact is queried, sorted and
 * edited one at a time. Order is `position`, then the most recent year first.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { requireApiSession, forbiddenResponse, parseBody } from '@/lib/api/route';
import { resolveProfileUserId } from '@/lib/identity/connection';

type RouteContext = { params: Promise<{ personId: string }> };

export interface EducationEntry {
  id: string;
  school: string;
  degree: string | null;
  field: string | null;
  startYear: string | null;
  endYear: string | null;
  description: string | null;
  imageUrl: string | null;
  position: number;
}

const year = z.string().regex(/^\d{4}$/, 'Use a four-digit year').nullish();
const entryShape = {
  school: z.string().trim().min(1).max(200),
  degree: z.string().trim().max(200).nullish(),
  field: z.string().trim().max(200).nullish(),
  startYear: year,
  endYear: year,
  description: z.string().trim().max(2000).nullish(),
  imageUrl: z.string().trim().max(2000).nullish(),
  position: z.number().int().min(0).max(999).optional(),
};
const createSchema = z.object(entryShape);
/** Every field optional but `id` — the caller sends only what changed. */
const patchSchema = z.object({ id: z.string().min(1) }).extend(
  Object.fromEntries(Object.entries(entryShape).map(([k, v]) => [k, v.optional()])) as {
    [K in keyof typeof entryShape]: z.ZodOptional<(typeof entryShape)[K]>
  },
);

/** Newest first, with an explicit position winning. */
function sortRows<T extends { position: number; endYear: string | null; startYear: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    a.position - b.position ||
    (b.endYear ?? b.startYear ?? '').localeCompare(a.endYear ?? a.startYear ?? ''),
  );
}

async function list(userId: string): Promise<EducationEntry[]> {
  const rows = await prisma.profileEducation.findMany({
    where: { userId },
    select: {
      id: true, school: true, degree: true, field: true,
      startYear: true, endYear: true, description: true, imageUrl: true, position: true,
    },
  });
  return sortRows(rows);
}

/** The member behind the node, and whether the viewer is them. */
async function owner(personId: string, viewerId: string) {
  const userId = await resolveProfileUserId(personId);
  return { userId, isOwner: !!userId && userId === viewerId };
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { personId } = await context.params;
  const { userId, isOwner } = await owner(personId, session.userId);
  if (!userId) return NextResponse.json({ education: [], isOwner: false });
  return NextResponse.json({ education: await list(userId), isOwner });
}

export async function POST(req: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { personId } = await context.params;
  const { userId, isOwner } = await owner(personId, session.userId);
  if (!userId || !isOwner) return forbiddenResponse();

  const body = await parseBody(req, createSchema);
  if (body instanceof NextResponse) return body;

  await prisma.profileEducation.create({ data: { userId, ...body } });
  return NextResponse.json({ education: await list(userId), isOwner: true });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { personId } = await context.params;
  const { userId, isOwner } = await owner(personId, session.userId);
  if (!userId || !isOwner) return forbiddenResponse();

  const body = await parseBody(req, patchSchema);
  if (body instanceof NextResponse) return body;
  const { id, ...patch } = body;

  const { count } = await prisma.profileEducation.updateMany({ where: { id, userId }, data: patch });
  if (count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ education: await list(userId), isOwner: true });
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { personId } = await context.params;
  const { userId, isOwner } = await owner(personId, session.userId);
  if (!userId || !isOwner) return forbiddenResponse();

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  await prisma.profileEducation.deleteMany({ where: { id, userId } });
  return NextResponse.json({ education: await list(userId), isOwner: true });
}
