import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';

// GET /api/feed?communityId=xxx&cursor=xxx&limit=20
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const communityId = searchParams.get('communityId');
  if (!communityId) {
    return NextResponse.json({ error: 'communityId required' }, { status: 400 });
  }

  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);
  const cursor = searchParams.get('cursor');

  const posts = await prisma.post.findMany({
    where: { communityId },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: 'desc' },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          image: true,
          person: { select: { subtitle: true, imageUrl: true } },
        },
      },
      images: { orderBy: { position: 'asc' } },
      reactions: { select: { userId: true, emoji: true } },
      comments: {
        where: { parentId: null },
        orderBy: { createdAt: 'asc' },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              image: true,
              person: { select: { subtitle: true, imageUrl: true } },
            },
          },
          reactions: { select: { userId: true, emoji: true } },
          replies: {
            orderBy: { createdAt: 'asc' },
            include: {
              author: {
                select: {
                  id: true,
                  name: true,
                  image: true,
                  person: { select: { subtitle: true, imageUrl: true } },
                },
              },
              reactions: { select: { userId: true, emoji: true } },
            },
          },
        },
      },
      _count: { select: { reactions: true, comments: true } },
    },
  });

  const hasMore = posts.length > limit;
  const items = hasMore ? posts.slice(0, limit) : posts;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return NextResponse.json({ posts: items, nextCursor });
}

// POST /api/feed - create a new post
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { communityId, content, imageUrls, mentions } = body;

  if (!communityId || !content?.trim()) {
    return NextResponse.json({ error: 'communityId and content required' }, { status: 400 });
  }

  const post = await prisma.post.create({
    data: {
      communityId,
      authorId: session.userId,
      content: content.trim(),
      images: imageUrls?.length
        ? {
            create: imageUrls.map((url: string, i: number) => ({
              imageUrl: url,
              position: i,
            })),
          }
        : undefined,
      mentions: mentions?.length
        ? {
            create: mentions.map((userId: string) => ({
              mentionedUserId: userId,
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
      images: { orderBy: { position: 'asc' } },
      reactions: { select: { userId: true, emoji: true } },
      comments: {
        where: { parentId: null },
        orderBy: { createdAt: 'asc' },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              image: true,
              person: { select: { subtitle: true, imageUrl: true } },
            },
          },
          reactions: { select: { userId: true, emoji: true } },
          replies: {
            orderBy: { createdAt: 'asc' },
            include: {
              author: {
                select: {
                  id: true,
                  name: true,
                  image: true,
                  person: { select: { subtitle: true, imageUrl: true } },
                },
              },
              reactions: { select: { userId: true, emoji: true } },
            },
          },
        },
      },
      _count: { select: { reactions: true, comments: true } },
    },
  });

  return NextResponse.json({ post }, { status: 201 });
}
