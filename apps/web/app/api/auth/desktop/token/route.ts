import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createSession, MAX_AGE } from '@/lib/session';
import { ensureHomeNodeId } from '@/lib/auth/bootstrap';
import { readHandoff, verifierMatches } from '@/lib/auth/desktopHandoff';
import { takeToken } from '@/lib/rateLimit';

/**
 * The second half of the desktop round trip: the shell posts back the handoff
 * the browser gave it, together with the verifier it has held in memory since
 * it opened the browser. Only the two together are a session — which is what
 * makes the deep link safe to travel over a custom scheme.
 */

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { handoff?: unknown; verifier?: unknown }
    | null;
  const handoff = typeof body?.handoff === 'string' ? body.handoff : null;
  const verifier = typeof body?.verifier === 'string' ? body.verifier : null;
  if (!handoff || !verifier) {
    return NextResponse.json({ error: 'A handoff and a verifier are required.' }, { status: 400 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const limit = await takeToken(`desktop:token:${ip}`, { capacity: 10, refillPerSec: 0.2 });
  if (!limit.ok) {
    return NextResponse.json({ error: 'Too many attempts.' }, { status: 429 });
  }

  const claims = await readHandoff(handoff);
  if (!claims || !verifierMatches(verifier, claims.challenge)) {
    return NextResponse.json({ error: 'That sign-in has expired. Try again.' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, name: true, email: true, image: true, isActive: true },
  });
  if (!user || !user.isActive) {
    return NextResponse.json({ error: 'That account cannot sign in.' }, { status: 401 });
  }

  const nodeId = await ensureHomeNodeId(user);
  const token = await createSession({
    userId: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    nodeId,
  });

  return NextResponse.json({
    token,
    maxAgeSeconds: MAX_AGE,
    email: user.email,
    name: user.name,
  });
}
