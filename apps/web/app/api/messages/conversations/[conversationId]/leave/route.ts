import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { ensureConversationMember, getConversationMemberIds, leaveConversation } from '@/lib/messages';
import { publishToUsers } from '@/lib/messages/realtime';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const user = await getApiMessagingUser();

    if (!user) {
      return unauthorizedResponse();
    }

    const { conversationId } = await params;
    await ensureConversationMember(conversationId, user.id);
    const memberIdsBeforeLeave = await getConversationMemberIds(conversationId);

    await leaveConversation(user.id, conversationId);

    publishToUsers(memberIdsBeforeLeave, {
      type: 'conversation.updated',
      conversationId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleMessagingError(error);
  }
}
