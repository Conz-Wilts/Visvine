import { NextRequest, NextResponse } from 'next/server';
import { isWellFormedChallenge } from '@/lib/auth/handoff';

/**
 * The door a shell built before the page existed knocks on. The sign-in itself
 * is `/desktop/signin`, which is drawn in the app's own hand; this only
 * forwards to it so an older desktop build keeps working.
 */

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  const challenge = req.nextUrl.searchParams.get('challenge');
  const to = new URL('/desktop/signin', req.nextUrl.origin);
  if (isWellFormedChallenge(challenge)) to.searchParams.set('challenge', challenge);
  return NextResponse.redirect(to);
}
