/**
 * Work Experience API
 * GET  /api/profile/[personId]/experience        → list
 * POST /api/profile/[personId]/experience        → create
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';

type RouteContext = { params: Promise<{ personId: string }> };

async function assertOwner(personId: string, userId: string) {
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { userId: true } });
  return person?.userId === userId;
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const { personId } = await context.params;
  const rows = await prisma.workExperience.findMany({
    where: { personId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest, context: RouteContext) {
  const { personId } = await context.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await assertOwner(personId, session.userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { title, company, location, startDate, endDate, current, description } = await req.json();
  if (!title || !company || !startDate) {
    return NextResponse.json({ error: 'title, company, and startDate are required' }, { status: 400 });
  }

  const row = await prisma.workExperience.create({
    data: { personId, title, company, location, startDate, endDate, current: !!current, description },
  });
  return NextResponse.json(row, { status: 201 });
}
