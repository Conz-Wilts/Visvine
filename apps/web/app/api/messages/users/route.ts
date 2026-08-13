import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { searchUsersAndDirectory } from '@/lib/messages';

export async function GET(request: NextRequest) {
  try {
    const user = await getApiMessagingUser();

    if (!user) {
      return unauthorizedResponse();
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query') ?? undefined;

    const { users, directoryPeople } = await searchUsersAndDirectory(user.id, query);
    // Drop email from the wire — the picker only needs id/name/image, and email
    // is confidential contact data even among shared-community members.
    const safeUsers = users.map(({ email: _email, ...u }) => u);
    return NextResponse.json({ users: safeUsers, directoryPeople });
  } catch (error) {
    return handleMessagingError(error);
  }
}
