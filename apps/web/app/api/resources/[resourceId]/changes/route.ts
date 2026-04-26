import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';

async function assertMember(resourceId: string, userId: string) {
  const resource = await prisma.resource.findUnique({ where: { id: resourceId }, select: { communityId: true } });
  if (!resource) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const membership = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId, communityId: resource.communityId } },
    select: { id: true },
  });
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ resourceId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { resourceId } = await params;
  const denied = await assertMember(resourceId, session.userId);
  if (denied) return denied;

  const status = req.nextUrl.searchParams.get('status') ?? undefined;
  const where: Record<string, string> = { resourceId };
  if (status) where.status = status;
  const changes = await prisma.resourceChange.findMany({ where, orderBy: { createdAt: 'desc' } });
  return NextResponse.json(changes);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ resourceId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { resourceId } = await params;
  const denied = await assertMember(resourceId, session.userId);
  if (denied) return denied;

  const body = await req.json();
  const change = await prisma.resourceChange.create({
    data: {
      resourceId,
      cellRef: body.cellRef,
      originalValue: body.originalValue ?? null,
      proposedValue: body.proposedValue,
      reason: body.reason ?? null,
      proposedBy: session.userId,
    },
  });
  return NextResponse.json(change);
}
