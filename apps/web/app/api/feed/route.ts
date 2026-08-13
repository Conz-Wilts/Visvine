import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiSession } from '@/lib/api/route';
import { featureAccessForbidden, communityMemberForbidden } from '@/lib/auth';

// Caps on nested fan-out per post. No web UI renders comments inline yet (the
// MCP `list_feed` tool that used to consume this was removed with the rest of
// the non-context tool surface), so a moderate cap is safe. Totals are still
// available for a future "view all" affordance: `_count.comments` on each post
// (all comments incl. replies) and `_count.replies` on each top-level comment.
const COMMENTS_PER_POST = 20;
const REPLIES_PER_COMMENT = 20;

// GET /api/feed?communityId=xxx&cursor=xxx&limit=20
export async function GET(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { searchParams } = new URL(req.url);
  const communityId = searchParams.get('communityId');
  if (!communityId) {
    return NextResponse.json({ error: 'communityId required' }, { status: 400 });
  }

  // The posts feed is community-scoped: an active member (feature check below
  // also enforces the Channels tool being enabled). Membership stops any
  // signed-in user from reading a foreign community's feed via its id.
  if (
    (await communityMemberForbidden(session.userId, communityId, session.email)) ||
    (await featureAccessForbidden(session.userId, communityId, 'channels', session.email))
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
        // Fetch the LATEST top-level comments (desc + take), reversed below so
        // the response stays chronological-ascending like before.
        orderBy: { createdAt: 'desc' },
        take: COMMENTS_PER_POST,
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
          _count: { select: { replies: true } },
          replies: {
            orderBy: { createdAt: 'asc' },
            take: REPLIES_PER_COMMENT,
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

  // Restore ascending order within each post's capped comment window.
  for (const post of items) post.comments.reverse();

  return NextResponse.json({ posts: items, nextCursor });
}

// POST /api/feed - create a new post
export async function POST(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const body = await req.json();
  const { communityId, content, imageUrls } = body;

  if (!communityId || !content?.trim()) {
    return NextResponse.json({ error: 'communityId and content required' }, { status: 400 });
  }

  if (await featureAccessForbidden(session.userId, communityId, 'channels', session.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
