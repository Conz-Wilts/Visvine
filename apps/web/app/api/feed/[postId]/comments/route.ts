import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';

// POST /api/feed/[postId]/comments
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { postId } = await params;
  const { content, mentions, parentId } = await req.json();

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
      mentions: mentions?.length
        ? {
            create: mentions.map((userId: string) => ({
              mentionedUserId: userId,
              postId,
            })),
          }
        : undefined,
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
