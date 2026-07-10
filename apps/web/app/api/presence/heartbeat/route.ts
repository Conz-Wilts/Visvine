import { NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { heartbeat } from '@/lib/presence';

export async function POST() {
  const user = await getApiMessagingUser();
  if (!user) return unauthorizedResponse();
  heartbeat(user.id);
  return NextResponse.json({ ok: true });
}
