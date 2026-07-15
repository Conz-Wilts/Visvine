import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiSession } from '@/lib/api/route';

// POST /api/feed/[postId]/comments/[commentId]/reactions - toggle emoji reaction on comment
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string; commentId: string }> }
) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { postId, commentId } = await params;
  const { emoji } = await req.json();

  if (!emoji || typeof emoji !== 'string' || emoji.length > 8) {
    return NextResponse.json({ error: 'Invalid emoji' }, { status: 400 });
  }

  // Validate comment belongs to post
  const comment = await prisma.postComment.findFirst({
    where: { id: commentId, postId },
  });

  if (!comment) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
  }

  const userId = session.userId;

  const existing = await prisma.postCommentReaction.findUnique({
    where: { commentId_userId_emoji: { commentId, userId, emoji } },
  });

  if (existing) {
    await prisma.postCommentReaction.delete({ where: { id: existing.id } });
    return NextResponse.json({ reacted: false, emoji });
  } else {
    await prisma.postCommentReaction.create({ data: { commentId, userId, emoji } });
    return NextResponse.json({ reacted: true, emoji });
  }
}
