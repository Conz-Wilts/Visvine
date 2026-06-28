import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse, forbiddenResponse } from '@/lib/messages/auth';
import prisma from '@/lib/prisma';
import { publishToUsers } from '@/lib/messages/realtime';
import { getConversationMemberIds } from '@/lib/messages/service';

// POST body: { state: 'delivered' | 'read' }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string; messageId: string }> },
) {
  const user = await getApiMessagingUser();
  if (!user) return unauthorizedResponse();
  const { conversationId, messageId } = await params;
  const member = await prisma.conversationMember.findFirst({ where: { conversationId, userId: user.id } });
  if (!member) return forbiddenResponse();
  const { state } = await request.json().catch(() => ({}));
  if (state !== 'delivered' && state !== 'read') {
    return NextResponse.json({ error: 'Invalid state' }, { status: 400 });
  }
  const now = new Date();
  await prisma.messageDelivery.upsert({
    where: { messageId_userId: { messageId, userId: user.id } },
    create: {
      messageId,
      userId: user.id,
      deliveredAt: now,
      readAt: state === 'read' ? now : null,
    },
    update: state === 'read'
      ? { readAt: now, deliveredAt: { set: now } }
      : { deliveredAt: now },
  });
  const memberIds = await getConversationMemberIds(conversationId);
  publishToUsers(memberIds, { type: 'conversation.updated', conversationId });
  return NextResponse.json({ ok: true });
}
