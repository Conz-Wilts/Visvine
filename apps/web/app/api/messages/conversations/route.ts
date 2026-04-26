import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { listConversationsForUser } from '@/lib/messages/service';

export async function GET(request: NextRequest) {
  try {
    const user = await getApiMessagingUser();

    if (!user) {
      return unauthorizedResponse();
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query') ?? undefined;
    const conversations = await listConversationsForUser(user.id, query);

    return NextResponse.json({ conversations });
  } catch (error) {
    return handleMessagingError(error);
  }
}
