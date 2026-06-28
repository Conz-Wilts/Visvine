import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

export interface ApiMessagingUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export async function getApiMessagingUser(): Promise<ApiMessagingUser | null> {
  // getSession() already prefers a Bearer token (mobile) over the cookie (web).
  const session = await getSession();
  if (!session) return null;
  return {
    id: session.userId,
    name: session.name,
    email: session.email,
    image: session.image ?? null,
  };
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
