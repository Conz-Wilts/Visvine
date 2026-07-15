import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { toggleStar } from '@/lib/messages';

/** Toggle a per-user star (saved message). No realtime fan-out — stars are private. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ conversationId: string; messageId: string }> },
) {
  try {
    const user = await getApiMessagingUser();
    if (!user) return unauthorizedResponse();
    const { conversationId, messageId } = await params;
    const result = await toggleStar(user.id, conversationId, messageId);
    return NextResponse.json(result);
  } catch (error) {
    return handleMessagingError(error);
  }
}
