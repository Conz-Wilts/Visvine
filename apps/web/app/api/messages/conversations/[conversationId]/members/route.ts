import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { getConversationMemberIds, addMembersToGroup } from '@/lib/messages';
import { publishToUsers } from '@/lib/messages/realtime';
import { z } from 'zod';

const addMembersSchema = z.object({
  memberIds: z.array(z.string().min(1)).min(1),
});

export async function POST(
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
    const parsed = addMembersSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const conversation = await addMembersToGroup(user.id, conversationId, parsed.data.memberIds);
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
