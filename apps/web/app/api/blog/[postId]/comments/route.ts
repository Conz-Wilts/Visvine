import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession, isSuperAdmin } from '@/lib/session';

const authorSelect = { select: { id: true, name: true, image: true } };
const reactionSelect = { select: { userId: true, emoji: true } };

type Params = { params: Promise<{ postId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { postId } = await params;
  const session = await getSession();
  const admin = isSuperAdmin(session?.email);

  const visibilityFilter = admin ? {} : { isPrivate: false };

  const raw = await prisma.blogComment.findMany({
    where: { postId, parentId: null, ...visibilityFilter },
    include: {
      author: authorSelect,
      reactions: reactionSelect,
      replies: {
        where: visibilityFilter,
        orderBy: { createdAt: 'asc' },
        include: {
          author: authorSelect,
          reactions: reactionSelect,
        },
      },
    },
  });

  const userId = session?.userId ?? null;
  const comments = raw.sort((a, b) => {
    const mine = (c: typeof a) => (userId && c.authorId === userId ? 1 : 0);
    const score = (c: typeof a) => c.replies.length + c.reactions.length;
    return mine(b) - mine(a) || score(b) - score(a);
  });

  return NextResponse.json({ comments });
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  const { postId } = await params;
  const body = await req.json();
  const content: string = body.content;
  const isPrivate: boolean = Boolean(body.isPrivate);
  const parentId: string | null = body.parentId ?? null;
  const guestName: string | null = body.guestName ?? null;

  if (!content?.trim()) {
    return NextResponse.json({ error: 'content required' }, { status: 400 });
  }

  // Must be logged in, or provide a guest name, or explicitly anonymous (guestName === null)
  if (!session && guestName === undefined) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }

  let effectiveIsPrivate = isPrivate;
  if (parentId) {
    const parent = await prisma.blogComment.findFirst({ where: { id: parentId, postId } });
    if (!parent) return NextResponse.json({ error: 'Parent not found' }, { status: 404 });
    if (parent.parentId) return NextResponse.json({ error: 'Cannot reply to a reply' }, { status: 400 });
    if (parent.isPrivate) effectiveIsPrivate = true;
  }

  const comment = await prisma.blogComment.create({
    data: {
      postId,
      authorId: session?.userId ?? null,
      guestName: session ? null : (guestName?.trim() || null),
      parentId,
      content: content.trim(),
      isPrivate: effectiveIsPrivate,
    },
    include: {
      author: authorSelect,
      reactions: reactionSelect,
      replies: { include: { author: authorSelect, reactions: reactionSelect } },
    },
  });

  return NextResponse.json({ comment }, { status: 201 });
}
