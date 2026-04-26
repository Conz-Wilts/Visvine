import { NextRequest, NextResponse } from 'next/server';
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

    const conversation = await createDmConversation(user.id, parsed.data.userId);
    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    return handleMessagingError(error);
  }
}
