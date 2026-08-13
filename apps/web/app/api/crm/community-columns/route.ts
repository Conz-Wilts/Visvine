import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession, forbiddenResponse } from '@/lib/api/route';
import { communityMemberForbidden } from '@/lib/auth';
import prisma from '@/lib/prisma';

// GET /api/crm/community-columns?community_id=X
// The CRM column schema (column names like "check size", "pass reason") is
// confidential per-community metadata: session + active membership required.
export async function GET(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const communityId = req.nextUrl.searchParams.get('community_id');
  if (!communityId) return NextResponse.json({ error: 'community_id required' }, { status: 400 });
  if (await communityMemberForbidden(session.userId, communityId, session.email)) return forbiddenResponse();

  const columns = await prisma.communityColumn.findMany({
    where: { communityId },
    orderBy: { position: 'asc' },
  });

  return NextResponse.json({ columns });
}
