import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiSession } from '@/lib/api/route';

// POST /api/feed/[postId]/reactions - toggle emoji reaction
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { postId } = await params;
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
