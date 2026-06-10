import { NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { joinChannel, getConversationMemberIds } from '@/lib/messages/service';
import { publishToUsers } from '@/lib/messages/realtime';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const user = await getApiMessagingUser();

    if (!user) {
      return unauthorizedResponse();
    }

    const { conversationId } = await params;
    const conversation = await joinChannel(user.id, conversationId);

    const memberIds = await getConversationMemberIds(conversationId);

    publishToUsers(memberIds, {
      type: 'conversation.updated',
      conversationId,
    });

    return NextResponse.json({ conversation });
  } catch (error) {
    return handleMessagingError(error);
  }
}
