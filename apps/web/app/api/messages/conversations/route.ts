import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { handleMessagingError } from '@/lib/messages/http';
import { z } from 'zod';
import { findOrCreateDm, listConversationsForUser } from '@/lib/messages';
import { parseBody } from '@/lib/api/route';

export async function GET(request: NextRequest) {
  try {
    const user = await getApiMessagingUser();

    if (!user) {
      return unauthorizedResponse();
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query') ?? undefined;
    const conversations = await listConversationsForUser(user.id, query);

    return NextResponse.json({ conversations });
  } catch (error) {
    return handleMessagingError(error);
  }
}

const createDmSchema = z.object({ userId: z.string().min(1).max(200) });

/**
 * POST — the DM with one person, made on first use: `{ conversation }`.
 * The phone's "New message" door (docs/mobile.md). Channels are made at
 * `…/conversations/channel`; there is no group creation here.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getApiMessagingUser();
    if (!user) return unauthorizedResponse();
    const body = await parseBody(request, createDmSchema);
    if (body instanceof NextResponse) return body;
    const conversation = await findOrCreateDm(user.id, body.userId);
    return NextResponse.json({ conversation });
  } catch (error) {
    return handleMessagingError(error);
  }
}
