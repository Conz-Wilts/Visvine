import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';

type Params = { params: Promise<{ commentId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { commentId } = await params;
  const { emoji } = await req.json();

  if (!emoji || typeof emoji !== 'string' || emoji.length > 8) {
    return NextResponse.json({ error: 'Invalid emoji' }, { status: 400 });
  }

  const comment = await prisma.blogComment.findUnique({ where: { id: commentId } });
  if (!comment) return NextResponse.json({ error: 'Comment not found' }, { status: 404 });

  const userId = session.userId;

  const existing = await prisma.blogCommentReaction.findUnique({
    where: { commentId_userId_emoji: { commentId, userId, emoji } },
  });

  if (existing) {
    await prisma.blogCommentReaction.delete({ where: { id: existing.id } });
    return NextResponse.json({ reacted: false, emoji });
  } else {
    await prisma.blogCommentReaction.create({ data: { commentId, userId, emoji } });
    return NextResponse.json({ reacted: true, emoji });
  }
}
