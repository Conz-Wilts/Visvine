import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { listChannelsForCommunity, listChannelSpaces } from '@/lib/messages/service';

export async function GET(request: NextRequest) {
  try {
    const user = await getApiMessagingUser();

    if (!user) {
      return unauthorizedResponse();
    }

    const { searchParams } = new URL(request.url);
    const communityId = searchParams.get('communityId');

    if (!communityId) {
      return NextResponse.json({ error: 'communityId is required' }, { status: 400 });
    }

    const [channels, spaces] = await Promise.all([
      listChannelsForCommunity(user.id, communityId),
      listChannelSpaces(communityId),
    ]);

    return NextResponse.json({ channels, spaces });
  } catch (error) {
    return handleMessagingError(error);
  }
}
