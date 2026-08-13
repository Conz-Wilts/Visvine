import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiSession, forbiddenResponse } from '@/lib/api/route';
import { communityMemberForbidden, featureAccessForbidden } from '@/lib/auth';

// POST /api/feed/[postId]/comments
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { postId } = await params;

  // The post's community is the authorization boundary: only an active member
  // with the Channels tool enabled may comment — otherwise any signed-in user
  // could post into a foreign community's feed by guessing a post id.
  const post = await prisma.post.findUnique({ where: { id: postId }, select: { communityId: true } });
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  if (
    (await communityMemberForbidden(session.userId, post.communityId, session.email)) ||
    (await featureAccessForbidden(session.userId, post.communityId, 'channels', session.email))
  ) {
    return forbiddenResponse();
  }

  const { content, parentId } = await req.json();

  if (!content?.trim()) {
    return NextResponse.json({ error: 'content required' }, { status: 400 });
  }

  // Validate parentId if provided (single-level threading only)
  if (parentId) {
    const parent = await prisma.postComment.findFirst({
      where: { id: parentId, postId },
    });
    if (!parent) {
      return NextResponse.json({ error: 'Parent comment not found' }, { status: 404 });
    }
    if (parent.parentId) {
      return NextResponse.json({ error: 'Cannot reply to a reply' }, { status: 400 });
    }
  }

  const comment = await prisma.postComment.create({
    data: {
      postId,
      authorId: session.userId,
      parentId: parentId || null,
      content: content.trim(),
    },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          image: true,
          person: { select: { subtitle: true, imageUrl: true } },
        },
      },
    },
  });

  return NextResponse.json({ comment }, { status: 201 });
}
