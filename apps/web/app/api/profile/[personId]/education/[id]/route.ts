import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';

type RouteContext = { params: Promise<{ personId: string; id: string }> };

async function assertOwner(personId: string, userId: string) {
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { userId: true } });
  return person?.userId === userId;
}

export async function PUT(req: NextRequest, context: RouteContext) {
  const { personId, id } = await context.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await assertOwner(personId, session.userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { school, degree, fieldOfStudy, startYear, endYear, description } = await req.json();
  const updated = await prisma.education.update({
    where: { id },
    data: { school, degree, fieldOfStudy, startYear, endYear, description },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { personId, id } = await context.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await assertOwner(personId, session.userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await prisma.education.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
