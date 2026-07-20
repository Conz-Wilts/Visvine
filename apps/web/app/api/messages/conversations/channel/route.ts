import { NextRequest, NextResponse } from 'next/server';
import { createChannelSchema } from '@/lib/messages/schemas';
import { getApiMessagingUser, unauthorizedResponse, forbiddenResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { createChannelConversation } from '@/lib/messages';
import { isAdmin } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const user = await getApiMessagingUser();

    if (!user) {
      return unauthorizedResponse();
    }

    const body = await request.json();
    const parsed = createChannelSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const allowed = await isAdmin(user.id, parsed.data.communityId, user.email);

    if (!allowed) {
      return forbiddenResponse('Only community admins can create channels');
    }

    const conversation = await createChannelConversation(
      user.id,
      parsed.data.communityId,
      parsed.data.name,
      parsed.data.description,
      parsed.data.icon,
      parsed.data.spaceId,
      parsed.data.viewMode,
    );

    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    return handleMessagingError(error);
  }
}
