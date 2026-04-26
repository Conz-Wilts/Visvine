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
  const rows = await prisma.education.findMany({
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

  const { school, degree, fieldOfStudy, startYear, endYear, description } = await req.json();
  if (!school) return NextResponse.json({ error: 'school is required' }, { status: 400 });

  const row = await prisma.education.create({
    data: { personId, school, degree, fieldOfStudy, startYear, endYear, description },
  });
  return NextResponse.json(row, { status: 201 });
}
