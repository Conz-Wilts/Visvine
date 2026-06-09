/**
 * Single intro request.
 *   PATCH /api/intros/[id]  → approve | decline | accept (authorized by session)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { introActionSchema } from '@/lib/schemas/introSchemas';
import { transition, IntroError } from '@/lib/intros/service';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, context: RouteContext) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const parsed = introActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  try {
    const dto = await transition(session, id, parsed.data.action, parsed.data.endorsement);
    return NextResponse.json(dto);
  } catch (err) {
    if (err instanceof IntroError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
