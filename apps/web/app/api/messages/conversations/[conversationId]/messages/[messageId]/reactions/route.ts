import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { reactionSchema } from '@/lib/messages/schemas';
import { toggleReaction } from '@/lib/messages/service';
import { publishToUsers } from '@/lib/messages/realtime';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string; messageId: string }> },
) {
  try {
    const user = await getApiMessagingUser();
    if (!user) return unauthorizedResponse();

    const { conversationId, messageId } = await params;
    const body = await request.json();
    const parsed = reactionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { added, memberIds } = await toggleReaction(user.id, conversationId, messageId, parsed.data.emoji);

    publishToUsers(memberIds, {
      type: added ? 'reaction.added' : 'reaction.removed',
      conversationId,
      messageId,
      emoji: parsed.data.emoji,
      userId: user.id,
    });

    return NextResponse.json({ added });
  } catch (error) {
    return handleMessagingError(error);
  }
}
