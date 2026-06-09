/**
 * Intro requests collection.
 *   GET  /api/intros        → the viewer's inbox ({ incoming, sent, received })
 *   POST /api/intros        → create a request (requester derived from session)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { createIntroSchema } from '@/lib/schemas/introSchemas';
import { createIntro, listIntros, IntroError } from '@/lib/intros/service';

export async function GET() {
  const session = await requireSession();
  if (session instanceof Response) return session;
  const inbox = await listIntros(session);
  return NextResponse.json(inbox);
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const body = await req.json().catch(() => null);
  const parsed = createIntroSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const dto = await createIntro(session, parsed.data);
    return NextResponse.json(dto, { status: 201 });
  } catch (err) {
    if (err instanceof IntroError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
