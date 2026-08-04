import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireCommunityAdmin } from '@/lib/api/route';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ resourceId: string; changeId: string }> }) {
  const { resourceId, changeId } = await params;
  const change = await prisma.resourceChange.findUnique({
    where: { id: changeId },
    select: { resourceId: true, resource: { select: { communityId: true } } },
  });
  if (!change || change.resourceId !== resourceId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const session = await requireCommunityAdmin(change.resource.communityId);
  if (session instanceof NextResponse) return session;

  const body = await req.json();
  const { status } = body;
  const updated = await prisma.resourceChange.update({
    where: { id: changeId },
    data: { status, reviewedBy: session.userId, reviewedAt: new Date() },
  });
  return NextResponse.json(updated);
}
