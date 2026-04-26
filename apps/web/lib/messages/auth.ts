import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getSession, verifySession } from '@/lib/session';

export interface ApiMessagingUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export async function getApiMessagingUser(): Promise<ApiMessagingUser | null> {
  // Check Bearer token first (mobile clients)
  const headerStore = await headers();
  const authHeader = headerStore.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const session = await verifySession(token);
    if (session) {
      return {
        id: session.userId,
        name: session.name,
        email: session.email,
        image: session.image ?? null,
      };
    }
  }

  // Fall back to cookie session (web clients)
  const session = await getSession();
  if (!session) return null;
  return {
    id: session.userId,
    name: session.name,
    email: session.email,
    image: session.image ?? null,
  };
}

export async function getServerMessagingUser(): Promise<ApiMessagingUser | null> {
  return getApiMessagingUser();
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export function forbiddenResponse(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 });
}
