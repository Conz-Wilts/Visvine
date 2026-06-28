import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { editMessageSchema } from '@/lib/messages/schemas';
import { editMessage, deleteMessage } from '@/lib/messages/service';
import { publishToUsers } from '@/lib/messages/realtime';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string; messageId: string }> },
) {
  try {
    const user = await getApiMessagingUser();
    if (!user) return unauthorizedResponse();

    const { conversationId, messageId } = await params;
    const body = await request.json();
    const parsed = editMessageSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { message, memberIds } = await editMessage(user.id, conversationId, messageId, parsed.data.text);

    publishToUsers(memberIds, {
      type: 'message.updated',
      conversationId,
      message,
    });

    return NextResponse.json({ message });
  } catch (error) {
    return handleMessagingError(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ conversationId: string; messageId: string }> },
) {
  try {
    const user = await getApiMessagingUser();
    if (!user) return unauthorizedResponse();

    const { conversationId, messageId } = await params;
    const { memberIds } = await deleteMessage(user.id, conversationId, messageId);

    publishToUsers(memberIds, {
      type: 'message.deleted',
      conversationId,
      messageId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleMessagingError(error);
  }
}
