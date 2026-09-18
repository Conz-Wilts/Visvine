import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { createHandoff, isWellFormedChallenge } from '@/lib/auth/desktopHandoff';

/**
 * Where the desktop shell sends the system browser to sign in
 * (`lib/auth/desktopHandoff.ts` is the round trip). Signed out, it sends the
 * person through the ordinary sign-in and comes back here. Signed in, it offers
 * ONE link — the press is the approval, and it is the only thing that hands the
 * shell a session.
 */

export const dynamic = 'force-dynamic';

function page(body: string): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>Visvine desktop</title></head>` +
      `<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;` +
      `font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;background:#ffffff">` +
      `<main style="max-width:26rem;padding:2rem;text-align:center">${body}</main></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

export async function GET(req: NextRequest) {
  const challenge = req.nextUrl.searchParams.get('challenge');
  if (!isWellFormedChallenge(challenge)) {
    return page('<p>This sign-in link is malformed. Start again from the Visvine app.</p>');
  }

  const session = await getSession();
  if (!session) {
    const back = `${req.nextUrl.pathname}${req.nextUrl.search}`;
    const signIn = new URL('/signin', req.nextUrl.origin);
    signIn.searchParams.set('callbackUrl', back);
    return NextResponse.redirect(signIn);
  }

  const handoff = await createHandoff({ userId: session.userId, challenge });
  const link = `visvine-desktop://auth?handoff=${encodeURIComponent(handoff)}`;
  const who = session.email.replace(/[<>&"]/g, '');

  return page(
    `<h1 style="font-size:1.5rem;margin:0 0 .5rem">Open Visvine</h1>` +
      `<p style="margin:0 0 1.5rem;color:#6b7280">Signed in as ${who}</p>` +
      `<a href="${link}" style="display:inline-block;padding:.75rem 1.5rem;border-radius:.5rem;` +
      `background:#7ed07e;color:#0b3b0b;font-weight:600;text-decoration:none">Open the app</a>`,
  );
}
