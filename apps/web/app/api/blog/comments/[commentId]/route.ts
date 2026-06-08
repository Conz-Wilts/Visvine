import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireSession, isSuperAdmin } from '@/lib/session';

type Params = { params: Promise<{ commentId: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const { commentId } = await params;

  const comment = await prisma.blogComment.findUnique({ where: { id: commentId } });
  if (!comment) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const canDelete = (comment.authorId && comment.authorId === session.userId) || isSuperAdmin(session.email);
  if (!canDelete) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await prisma.blogComment.delete({ where: { id: commentId } });
  return NextResponse.json({ ok: true });
}
