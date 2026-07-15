import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { searchConversationsAndMessages } from '@/lib/messages';

export async function GET(request: NextRequest) {
  try {
    const user = await getApiMessagingUser();

    if (!user) {
      return unauthorizedResponse();
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query') ?? '';

    const results = await searchConversationsAndMessages(user.id, query);
    return NextResponse.json(results);
  } catch (error) {
    return handleMessagingError(error);
  }
}
