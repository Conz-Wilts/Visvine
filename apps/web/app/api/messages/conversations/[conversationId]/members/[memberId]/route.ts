import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { getConversationMemberIds, removeMemberFromGroup } from '@/lib/messages';
import { publishToUsers } from '@/lib/messages/realtime';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ conversationId: string; memberId: string }> },
) {
  try {
    const user = await getApiMessagingUser();

    if (!user) {
      return unauthorizedResponse();
    }

    const { conversationId, memberId } = await params;
    const conversation = await removeMemberFromGroup(user.id, conversationId, memberId);

    const memberIds = await getConversationMemberIds(conversationId);

    publishToUsers([...memberIds, memberId], {
      type: 'conversation.updated',
      conversationId,
    });

    return NextResponse.json({ conversation });
  } catch (error) {
    return handleMessagingError(error);
  }
}
