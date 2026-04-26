import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse, forbiddenResponse } from '@/lib/messages/auth';
import prisma from '@/lib/prisma';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ conversationId: string; messageId: string }> },
) {
  const user = await getApiMessagingUser();
  if (!user) return unauthorizedResponse();
  const { conversationId, messageId } = await params;
  const member = await prisma.conversationMember.findFirst({ where: { conversationId, userId: user.id } });
  if (!member) return forbiddenResponse();
  const existing = await prisma.messageStar.findUnique({
    where: { messageId_userId: { messageId, userId: user.id } },
  });
  if (existing) {
    await prisma.messageStar.delete({ where: { id: existing.id } });
    return NextResponse.json({ starred: false });
  }
  await prisma.messageStar.create({ data: { messageId, userId: user.id } });
  return NextResponse.json({ starred: true });
}
