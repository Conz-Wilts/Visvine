import { NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { presenceSnapshot } from '@/lib/presence';

export async function POST(req: Request) {
  const user = await getApiMessagingUser();
  if (!user) return unauthorizedResponse();
  const body = await req.json().catch(() => ({}));
  const userIds: string[] = Array.isArray(body.userIds) ? body.userIds.slice(0, 200) : [];
  return NextResponse.json({ presence: presenceSnapshot(userIds) });
}
