import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { listChannelsForCommunity, listChannelSpaces } from '@/lib/messages';
import { featureAccessForbidden } from '@/lib/auth';

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

    // A space that has removed Channels, or restricted it to admins, refuses
    // here too — not only in the sidebar that stopped showing the link.
    if (await featureAccessForbidden(user.id, communityId, 'channels', user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
