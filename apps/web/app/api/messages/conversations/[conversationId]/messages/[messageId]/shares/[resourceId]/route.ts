import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { removeMessageShare } from '@/lib/messages';
import { publishToUsers } from '@/lib/messages/realtime';

/**
 * DELETE …/messages/[messageId]/shares/[resourceId] — take a card or a file
 * off a message (lib/messages/messageService.ts#removeMessageShare).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ conversationId: string; messageId: string; resourceId: string }> },
) {
  try {
    const user = await getApiMessagingUser();
    if (!user) return unauthorizedResponse();
    const { conversationId, messageId, resourceId } = await params;
    const { message, memberIds } = await removeMessageShare(user.id, conversationId, messageId, resourceId);
    publishToUsers(memberIds, { type: 'message.updated', conversationId, message });
    return NextResponse.json({ message });
  } catch (error) {
    return handleMessagingError(error);
  }
}
