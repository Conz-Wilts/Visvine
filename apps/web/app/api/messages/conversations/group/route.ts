import { NextRequest, NextResponse } from 'next/server';
import { createGroupSchema } from '@/lib/messages/schemas';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { createGroupConversation, getConversationMemberIds } from '@/lib/messages';
import { publishToUsers } from '@/lib/messages/realtime';

export async function POST(request: NextRequest) {
  try {
    const user = await getApiMessagingUser();

    if (!user) {
      return unauthorizedResponse();
    }

    const body = await request.json();
    const parsed = createGroupSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const conversation = await createGroupConversation(
      user.id,
      parsed.data.name,
      parsed.data.memberIds,
      parsed.data.avatarUrl,
    );

    const memberIds = await getConversationMemberIds(conversation.id);

    publishToUsers(memberIds, {
      type: 'conversation.updated',
      conversationId: conversation.id,
    });

    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    return handleMessagingError(error);
  }
}
