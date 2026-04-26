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

  const { name, issuingOrg, issueDate, expiryDate, credentialId, credentialUrl } = await req.json();
  const updated = await prisma.certification.update({
    where: { id },
    data: { name, issuingOrg, issueDate, expiryDate, credentialId, credentialUrl },
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

  await prisma.certification.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
