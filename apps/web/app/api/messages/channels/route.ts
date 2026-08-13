import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { listChannelsForSpace, listChannelSections } from '@/lib/messages';
import { featureAccessForbidden } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = await getApiMessagingUser();

    if (!user) {
      return unauthorizedResponse();
    }

    const { searchParams } = new URL(request.url);
    const spaceId = searchParams.get('spaceId');

    if (!spaceId) {
      return NextResponse.json({ error: 'spaceId is required' }, { status: 400 });
    }

    // A section that has removed Channels, or restricted it to admins, refuses
    // here too — not only in the sidebar that stopped showing the link.
    if (await featureAccessForbidden(user.id, spaceId, 'channels', user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [channels, sections] = await Promise.all([
      listChannelsForSpace(user.id, spaceId),
      listChannelSections(spaceId),
    ]);

    return NextResponse.json({ channels, sections });
  } catch (error) {
    return handleMessagingError(error);
  }
}
