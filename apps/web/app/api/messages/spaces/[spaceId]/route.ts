import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getApiMessagingUser, unauthorizedResponse, forbiddenResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { updateSpaceSchema } from '@/lib/messages/schemas';
import { updateChannelSpace, deleteChannelSpace } from '@/lib/messages/service';
import { isAdmin } from '@/lib/auth';

async function requireSpaceAdmin(userId: string, email: string, spaceId: string) {
  const space = await prisma.channelSpace.findUnique({
    where: { id: spaceId },
    select: { communityId: true },
  });
  if (!space) return { error: NextResponse.json({ error: 'Space not found' }, { status: 404 }) };
  const allowed = await isAdmin(userId, space.communityId, email);
  if (!allowed) return { error: forbiddenResponse('Only community admins can manage spaces') };
  return { error: null };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  try {
    const user = await getApiMessagingUser();
    if (!user) return unauthorizedResponse();
    const { spaceId } = await params;

    const { error } = await requireSpaceAdmin(user.id, user.email, spaceId);
    if (error) return error;

    const body = await request.json();
    const parsed = updateSpaceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const space = await updateChannelSpace(spaceId, parsed.data);
    return NextResponse.json({ space });
  } catch (error) {
    return handleMessagingError(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  try {
    const user = await getApiMessagingUser();
    if (!user) return unauthorizedResponse();
    const { spaceId } = await params;

    const { error } = await requireSpaceAdmin(user.id, user.email, spaceId);
    if (error) return error;

    await deleteChannelSpace(spaceId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleMessagingError(error);
  }
}
