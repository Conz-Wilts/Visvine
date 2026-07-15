import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { sendMessageSchema } from '@/lib/messages/schemas';
import { listMessagesForConversation, sendMessage } from '@/lib/messages';
import { publishToUsers } from '@/lib/messages/realtime';
import { getIntroContextForUsers } from '@/lib/intros/service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const user = await getApiMessagingUser();

    if (!user) {
      return unauthorizedResponse();
    }

    const { conversationId } = await params;
    const { searchParams } = new URL(request.url);

    const cursor = searchParams.get('cursor') ?? undefined;
    const query = searchParams.get('query') ?? undefined;
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Number(limitParam) : 30;

    const page = await listMessagesForConversation(user.id, conversationId, {
      cursor,
      query,
      limit: Number.isFinite(limit) ? limit : 30,
    });

    // DMs born from an accepted introduction carry their provenance so the
    // thread can render an "introduced by …" banner. Skip on paginated loads.
    if (!cursor && page.conversation.type === 'DM' && page.conversation.participants.length === 2) {
      const [a, b] = page.conversation.participants;
      page.intro = await getIntroContextForUsers(a.id, b.id).catch(() => null);
    }

    return NextResponse.json(page);
  } catch (error) {
    return handleMessagingError(error);
  }
}

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
    const parsed = sendMessageSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { message, memberIds } = await sendMessage(user.id, conversationId, parsed.data);

    publishToUsers(memberIds, {
      type: 'message.new',
      conversationId,
      message,
    });

    publishToUsers(memberIds, {
      type: 'conversation.updated',
      conversationId,
    });

    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return handleMessagingError(error);
  }
}
