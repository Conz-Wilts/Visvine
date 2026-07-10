/**
 * GET /api/intros/count → { count } of intros awaiting the viewer's action.
 * Drives the topbar Intros bell badge.
 */

import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { pendingCount } from '@/lib/intros/service';

export async function GET() {
  const session = await requireSession();
  if (session instanceof Response) return session;
  const count = await pendingCount(session);
  return NextResponse.json({ count });
}
