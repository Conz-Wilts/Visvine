import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import prisma from '@/lib/prisma';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const user = await getApiMessagingUser();
  if (!user) return unauthorizedResponse();
  const { conversationId } = await params;
  const body = await request.json().catch(() => ({}));
  const archivedAt = body.unarchive ? null : new Date();
  await prisma.conversationMember.updateMany({
    where: { conversationId, userId: user.id },
    data: { archivedAt },
  });
  return NextResponse.json({ archivedAt: archivedAt?.toISOString() ?? null });
}
