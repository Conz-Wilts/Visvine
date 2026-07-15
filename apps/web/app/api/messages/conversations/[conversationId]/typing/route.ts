import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { typingSchema } from '@/lib/messages/schemas';
import { ensureConversationMember, getConversationMemberIds } from '@/lib/messages';
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
    const body = await request.json();
    const parsed = typingSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.issues },
        { status: 400 },
      );
    }

    await ensureConversationMember(conversationId, user.id);
    const memberIds = await getConversationMemberIds(conversationId);

    publishToUsers(memberIds, {
      type: 'typing',
      conversationId,
      userId: user.id,
      userName: user.name,
      isTyping: parsed.data.isTyping,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleMessagingError(error);
  }
}
