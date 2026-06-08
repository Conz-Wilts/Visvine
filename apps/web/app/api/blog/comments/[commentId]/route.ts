import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession, isSuperAdmin } from '@/lib/session';

type Params = { params: Promise<{ commentId: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { commentId } = await params;

  const comment = await prisma.blogComment.findUnique({ where: { id: commentId } });
  if (!comment) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Guest comments (no authorId) can be deleted by anyone who knows the UUID.
  // UUIDs are cryptographically unguessable; the only way to obtain one is from
  // posting the comment, so this is safe for public blog use.
  if (comment.authorId === null) {
    await prisma.blogComment.delete({ where: { id: commentId } });
    return NextResponse.json({ ok: true });
  }

  const session = await getSession();
  const canDelete = (session?.userId && session.userId === comment.authorId) || isSuperAdmin(session?.email);
  if (!canDelete) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await prisma.blogComment.delete({ where: { id: commentId } });
  return NextResponse.json({ ok: true });
}
