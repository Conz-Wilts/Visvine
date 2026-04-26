import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// GET /api/crm/community-columns?community_id=X
export async function GET(req: NextRequest) {
  const communityId = req.nextUrl.searchParams.get('community_id');
  if (!communityId) return NextResponse.json({ error: 'community_id required' }, { status: 400 });

  const columns = await prisma.communityColumn.findMany({
    where: { communityId },
    orderBy: { position: 'asc' },
  });

  return NextResponse.json({ columns });
}
