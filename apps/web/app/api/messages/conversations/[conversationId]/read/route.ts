import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { markReadSchema } from '@/lib/messages/schemas';
import { getConversationMemberIds, markConversationRead } from '@/lib/messages';
import { publishToUsers } from '@/lib/messages/realtime';

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
    const body = await request.json().catch(() => ({}));
    const parsed = markReadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const readAt = parsed.data.readAt ? new Date(parsed.data.readAt) : undefined;
    await markConversationRead(user.id, conversationId, readAt);

    const memberIds = await getConversationMemberIds(conversationId);

    publishToUsers(memberIds, {
      type: 'conversation.updated',
      conversationId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleMessagingError(error);
  }
}
