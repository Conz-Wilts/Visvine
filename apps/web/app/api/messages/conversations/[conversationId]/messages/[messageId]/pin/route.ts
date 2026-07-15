import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse, forbiddenResponse } from '@/lib/messages/auth';
import prisma from '@/lib/prisma';
import { publishToUsers } from '@/lib/messages/realtime';
import { getConversationMemberIds } from '@/lib/messages';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ conversationId: string; messageId: string }> },
) {
  const user = await getApiMessagingUser();
  if (!user) return unauthorizedResponse();
  const { conversationId, messageId } = await params;
  const member = await prisma.conversationMember.findFirst({ where: { conversationId, userId: user.id } });
  if (!member) return forbiddenResponse();
  const msg = await prisma.message.findFirst({ where: { id: messageId, conversationId } });
  if (!msg) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { pinnedAt: msg.pinnedAt ? null : new Date() },
  });
  const memberIds = await getConversationMemberIds(conversationId);
  publishToUsers(memberIds, { type: 'conversation.updated', conversationId });
  return NextResponse.json({ pinnedAt: updated.pinnedAt?.toISOString() ?? null });
}
