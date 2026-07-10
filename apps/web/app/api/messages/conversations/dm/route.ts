import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createDmSchema } from '@/lib/messages/schemas';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { createDmConversation } from '@/lib/messages/service';

export async function POST(request: NextRequest) {
  try {
    const user = await getApiMessagingUser();

    if (!user) {
      return unauthorizedResponse();
    }

    const body = await request.json();
    const parsed = createDmSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.issues },
        { status: 400 },
      );
    }

    let peerUserId = parsed.data.userId;
    if (!peerUserId && parsed.data.nodeId) {
      const person = await prisma.person.findUnique({
        where: { id: parsed.data.nodeId },
        select: { userId: true },
      });
      peerUserId = person?.userId ?? undefined;
      if (!peerUserId) {
        return NextResponse.json(
          { error: 'That profile is not linked to a user account yet.' },
          { status: 404 },
        );
      }
    }

    const conversation = await createDmConversation(user.id, peerUserId!);
    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    return handleMessagingError(error);
  }
}
