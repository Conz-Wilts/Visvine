import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiSession, handleApiError } from '@/lib/api/route';
import { requireVisibleResource } from '@/lib/resources/visibility';

async function assertMember(resourceId: string, userId: string, email?: string | null) {
  try {
    const resource = await requireVisibleResource(resourceId, userId, email);
    return { resource };
  } catch (err) {
    return { error: handleApiError(err, 'resources.review.gate') };
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ resourceId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { resourceId } = await params;
  const check = await assertMember(resourceId, session.userId, session.email);
  if (check.error) return check.error;

  const cellRef = req.nextUrl.searchParams.get('cellRef') ?? undefined;
  const where: Record<string, string> = { resourceId };
  if (cellRef) where.cellRef = cellRef;
  const comments = await prisma.resourceComment.findMany({ where, orderBy: { createdAt: 'asc' } });
  return NextResponse.json(comments);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ resourceId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { resourceId } = await params;
  const check = await assertMember(resourceId, session.userId, session.email);
  if (check.error) return check.error;

  const body = await req.json();
  const comment = await prisma.resourceComment.create({
    data: { resourceId, cellRef: body.cellRef ?? null, author: body.author ?? 'Anonymous', content: body.content },
  });
  return NextResponse.json(comment);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ resourceId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { resourceId } = await params;
  const check = await assertMember(resourceId, session.userId, session.email);
  if (check.error) return check.error;

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  // Scope delete to this resource — IDOR guard
  await prisma.resourceComment.deleteMany({ where: { id, resourceId } });
  return NextResponse.json({ success: true });
}
