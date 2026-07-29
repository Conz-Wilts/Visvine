import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse, forbiddenResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { createSpaceSchema } from '@/lib/messages/schemas';
import { createChannelSpace, listChannelSpaces } from '@/lib/messages';
import { isAdmin } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = await getApiMessagingUser();
    if (!user) return unauthorizedResponse();

    const { searchParams } = new URL(request.url);
    const communityId = searchParams.get('communityId');
    if (!communityId) {
      return NextResponse.json({ error: 'communityId is required' }, { status: 400 });
    }

    const spaces = await listChannelSpaces(communityId);
    return NextResponse.json({ spaces });
  } catch (error) {
    return handleMessagingError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getApiMessagingUser();
    if (!user) return unauthorizedResponse();

    const body = await request.json();
    const parsed = createSpaceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const allowed = await isAdmin(user.id, parsed.data.communityId, user.email);
    if (!allowed) {
      return forbiddenResponse('Only community admins can create spaces');
    }

    const space = await createChannelSpace(
      parsed.data.communityId,
      parsed.data.name,
      parsed.data.emoji,
      parsed.data.context,
      user.id,
    );
    return NextResponse.json({ space }, { status: 201 });
  } catch (error) {
    return handleMessagingError(error);
  }
}
