import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';

async function assertMember(resourceId: string, userId: string) {
  const resource = await prisma.resource.findUnique({ where: { id: resourceId }, select: { communityId: true } });
  if (!resource) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  const membership = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId, communityId: resource.communityId } },
    select: { id: true },
  });
  if (!membership) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return { resource };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ resourceId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { resourceId } = await params;
  const check = await assertMember(resourceId, session.userId);
  if (check.error) return check.error;

  const cellRef = req.nextUrl.searchParams.get('cellRef') ?? undefined;
  const where: Record<string, string> = { resourceId };
  if (cellRef) where.cellRef = cellRef;
  const comments = await prisma.resourceComment.findMany({ where, orderBy: { createdAt: 'asc' } });
  return NextResponse.json(comments);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ resourceId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { resourceId } = await params;
  const check = await assertMember(resourceId, session.userId);
  if (check.error) return check.error;

  const body = await req.json();
  const comment = await prisma.resourceComment.create({
    data: { resourceId, cellRef: body.cellRef ?? null, author: body.author ?? 'Anonymous', content: body.content },
  });
  return NextResponse.json(comment);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ resourceId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { resourceId } = await params;
  const check = await assertMember(resourceId, session.userId);
  if (check.error) return check.error;

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  // Scope delete to this resource — IDOR guard
  await prisma.resourceComment.deleteMany({ where: { id, resourceId } });
  return NextResponse.json({ success: true });
}
