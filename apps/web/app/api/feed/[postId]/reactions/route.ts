import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiSession, forbiddenResponse } from '@/lib/api/route';
import { communityMemberForbidden, featureAccessForbidden } from '@/lib/auth';

// POST /api/feed/[postId]/reactions - toggle emoji reaction
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { postId } = await params;

  // Reacting is a member action scoped to the post's own community.
  const post = await prisma.post.findUnique({ where: { id: postId }, select: { communityId: true } });
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  if (
    (await communityMemberForbidden(session.userId, post.communityId, session.email)) ||
    (await featureAccessForbidden(session.userId, post.communityId, 'channels', session.email))
  ) {
    return forbiddenResponse();
  }

  const { emoji } = await req.json();

  if (!emoji || typeof emoji !== 'string' || emoji.length > 8) {
    return NextResponse.json({ error: 'Invalid emoji' }, { status: 400 });
  }

  const userId = session.userId;

  const existing = await prisma.postReaction.findUnique({
    where: { postId_userId_emoji: { postId, userId, emoji } },
  });

  if (existing) {
    await prisma.postReaction.delete({ where: { id: existing.id } });
    return NextResponse.json({ reacted: false, emoji });
  } else {
    await prisma.postReaction.create({ data: { postId, userId, emoji } });
    return NextResponse.json({ reacted: true, emoji });
  }
}
