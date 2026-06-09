/**
 * GET /api/intros/mutuals?targetId=…&communityId=… → { mutuals }
 * The people the viewer and the target both know — candidate introducers.
 * The requester is always the session's person node.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { getMutuals } from '@/lib/intros/mutuals';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  if (!session.personId) {
    return NextResponse.json({ mutuals: [], error: 'no_profile' });
  }

  const { searchParams } = new URL(req.url);
  const targetId = searchParams.get('targetId');
  const communityId = searchParams.get('communityId') ?? undefined;
  if (!targetId) {
    return NextResponse.json({ error: 'targetId is required' }, { status: 400 });
  }

  const mutuals = await getMutuals(session.personId, targetId, communityId);
  return NextResponse.json({ mutuals });
}
