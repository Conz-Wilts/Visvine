import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse, forbiddenResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { createSectionSchema } from '@/lib/messages/schemas';
import { createChannelSection, listChannelSections } from '@/lib/messages';
import { featureAccessForbidden, isAdmin } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = await getApiMessagingUser();
    if (!user) return unauthorizedResponse();

    const { searchParams } = new URL(request.url);
    const spaceId = searchParams.get('spaceId');
    if (!spaceId) {
      return NextResponse.json({ error: 'spaceId is required' }, { status: 400 });
    }

    if (await featureAccessForbidden(user.id, spaceId, 'channels', user.email)) {
      return forbiddenResponse();
    }

    const sections = await listChannelSections(spaceId);
    return NextResponse.json({ sections });
  } catch (error) {
    return handleMessagingError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getApiMessagingUser();
    if (!user) return unauthorizedResponse();

    const body = await request.json();
    const parsed = createSectionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.issues },
        { status: 400 },
      );
    }

    // The tool before the permission: a space with Channels off has no sections
    // to group, and a section writes sections/<slug>/index.md — a namespace for
    // a tool the space does not run (lib/notes/shared/namespaces.ts).
    if (await featureAccessForbidden(user.id, parsed.data.spaceId, 'channels', user.email)) {
      return forbiddenResponse('Channels is switched off in this space');
    }

    const allowed = await isAdmin(user.id, parsed.data.spaceId, user.email);
    if (!allowed) {
      return forbiddenResponse('Only space admins can create sections');
    }

    const section = await createChannelSection(
      parsed.data.spaceId,
      parsed.data.name,
      parsed.data.icon,
      parsed.data.context,
      user.id,
    );
    return NextResponse.json({ section }, { status: 201 });
  } catch (error) {
    return handleMessagingError(error);
  }
}
