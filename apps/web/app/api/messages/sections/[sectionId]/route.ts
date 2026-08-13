import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getApiMessagingUser, unauthorizedResponse, forbiddenResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { updateSectionSchema } from '@/lib/messages/schemas';
import { updateChannelSection, deleteChannelSection } from '@/lib/messages';
import { isAdmin } from '@/lib/auth';

async function requireSectionAdmin(userId: string, email: string, sectionId: string) {
  const section = await prisma.channelSection.findUnique({
    where: { id: sectionId },
    select: { spaceId: true },
  });
  if (!section) return { error: NextResponse.json({ error: 'Section not found' }, { status: 404 }) };
  const allowed = await isAdmin(userId, section.spaceId, email);
  if (!allowed) return { error: forbiddenResponse('Only space admins can manage sections') };
  return { error: null };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sectionId: string }> },
) {
  try {
    const user = await getApiMessagingUser();
    if (!user) return unauthorizedResponse();
    const { sectionId } = await params;

    const { error } = await requireSectionAdmin(user.id, user.email, sectionId);
    if (error) return error;

    const body = await request.json();
    const parsed = updateSectionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const section = await updateChannelSection(sectionId, parsed.data);
    return NextResponse.json({ section });
  } catch (error) {
    return handleMessagingError(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sectionId: string }> },
) {
  try {
    const user = await getApiMessagingUser();
    if (!user) return unauthorizedResponse();
    const { sectionId } = await params;

    const { error } = await requireSectionAdmin(user.id, user.email, sectionId);
    if (error) return error;

    await deleteChannelSection(sectionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleMessagingError(error);
  }
}
