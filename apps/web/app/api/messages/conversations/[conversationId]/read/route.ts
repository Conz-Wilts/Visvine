import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { markReadSchema } from '@/lib/messages/schemas';
import { markConversationRead } from '@/lib/messages';
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

    // A read marker is the reader's own state — the unread count on their
    // other tabs. Nothing renders another member's read position, so the rest
    // of the conversation is not told (each such event costs every member a
    // full list refetch).
    publishToUsers([user.id], {
      type: 'conversation.updated',
      conversationId,
      readBy: user.id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleMessagingError(error);
  }
}
