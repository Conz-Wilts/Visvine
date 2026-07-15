import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { listPinnedMessages } from '@/lib/messages';

/** All pinned messages in a conversation (members only). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const user = await getApiMessagingUser();
    if (!user) return unauthorizedResponse();
    const { conversationId } = await params;
    const messages = await listPinnedMessages(user.id, conversationId);
    return NextResponse.json({ messages });
  } catch (error) {
    return handleMessagingError(error);
  }
}
