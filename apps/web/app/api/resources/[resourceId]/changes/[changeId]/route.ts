import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { assertCrmPermission, PermissionError } from '@/lib/crm/permissions';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ resourceId: string; changeId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { resourceId, changeId } = await params;
  const change = await prisma.resourceChange.findUnique({
    where: { id: changeId },
    select: { resourceId: true, resource: { select: { communityId: true } } },
  });
  if (!change || change.resourceId !== resourceId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    await assertCrmPermission(session.userId, session.email, change.resource.communityId, 'manage_members');
  } catch (e) {
    if (e instanceof PermissionError) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    throw e;
  }

  const body = await req.json();
  const { status } = body;
  const updated = await prisma.resourceChange.update({
    where: { id: changeId },
    data: { status, reviewedBy: session.userId, reviewedAt: new Date() },
  });
  return NextResponse.json(updated);
}
