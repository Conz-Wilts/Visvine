import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { updateGroupSchema } from '@/lib/messages/schemas';
import { getConversationMemberIds, updateGroupConversation } from '@/lib/messages/service';
import { publishToUsers } from '@/lib/messages/realtime';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const user = await getApiMessagingUser();

    if (!user) {
      return unauthorizedResponse();
    }

    const { conversationId } = await params;
    const body = await request.json();
    const parsed = updateGroupSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const conversation = await updateGroupConversation(user.id, conversationId, parsed.data);
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
