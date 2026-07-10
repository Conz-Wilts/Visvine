import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import prisma from '@/lib/prisma';

const DURATIONS: Record<string, number | 'forever'> = {
  '1h': 60 * 60 * 1000,
  '8h': 8 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
  forever: 'forever',
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const user = await getApiMessagingUser();
  if (!user) return unauthorizedResponse();
  const { conversationId } = await params;
  const body = await request.json().catch(() => ({}));
  const key = body.duration as keyof typeof DURATIONS | undefined;

  let mutedUntil: Date | null = null;
  if (key === undefined || body.unmute) {
    mutedUntil = null;
  } else if (DURATIONS[key] === 'forever') {
    mutedUntil = new Date('2999-01-01');
  } else if (typeof DURATIONS[key] === 'number') {
    mutedUntil = new Date(Date.now() + (DURATIONS[key] as number));
  } else {
    return NextResponse.json({ error: 'Invalid duration' }, { status: 400 });
  }

  await prisma.conversationMember.updateMany({
    where: { conversationId, userId: user.id },
    data: { mutedUntil },
  });
  return NextResponse.json({ mutedUntil: mutedUntil?.toISOString() ?? null });
}
