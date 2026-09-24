import { NextRequest, NextResponse } from 'next/server';
import { createChannelSchema } from '@/lib/messages/schemas';
import { getApiMessagingUser, unauthorizedResponse, forbiddenResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { createChannelConversation } from '@/lib/messages';
import { featureAccessForbidden, isAdmin } from '@/lib/auth';

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

    // The tool before the permission. Creating a channel writes
    // channels/<slug>/index.md, so without this an admin of a space with
    // Channels off could conjure the namespace for a tool the space does not
    // run — the sections route already reads this way.
    if (await featureAccessForbidden(user.id, parsed.data.spaceId, 'channels', user.email)) {
      return forbiddenResponse('Channels is switched off in this space');
    }

    const allowed = await isAdmin(user.id, parsed.data.spaceId, user.email);

    if (!allowed) {
      return forbiddenResponse('Only space admins can create channels');
    }

    const conversation = await createChannelConversation(
      user.id,
      parsed.data.spaceId,
      parsed.data.name,
      parsed.data.description,
      parsed.data.icon,
      parsed.data.sectionId,
      parsed.data.viewMode,
      parsed.data.context,
      parsed.data.visibility,
    );

    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    return handleMessagingError(error);
  }
}
