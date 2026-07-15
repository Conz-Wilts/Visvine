import { NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { listStarredMessages } from '@/lib/messages';

/** The current user's saved (starred) messages across all conversations. */
export async function GET() {
  try {
    const user = await getApiMessagingUser();
    if (!user) return unauthorizedResponse();
    const messages = await listStarredMessages(user.id);
    return NextResponse.json({ messages });
  } catch (error) {
    return handleMessagingError(error);
  }
}
