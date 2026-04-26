import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import prisma from '@/lib/prisma';

// GET /api/crm/community-values?community_id=X&node_ids[]=A
export async function GET(req: NextRequest) {
  const communityId = req.nextUrl.searchParams.get('community_id');
  const nodeIds = req.nextUrl.searchParams.getAll('node_ids[]');

  if (!communityId) return NextResponse.json({ error: 'community_id required' }, { status: 400 });

  const values = await prisma.communityColumnValue.findMany({
    where: {
      communityId,
      ...(nodeIds.length > 0 ? { nodeId: { in: nodeIds } } : {}),
    },
    include: {
      contributedBy: { select: { id: true, name: true, image: true } },
    },
  });

  // Shape: { [nodeId]: { [columnKey]: { value, contributedBy } } }
  const shaped: Record<string, Record<string, { value: string | null; contributedBy: { id: string; name: string; image: string | null } | null }>> = {};
  for (const v of values) {
    if (!shaped[v.nodeId]) shaped[v.nodeId] = {};
    shaped[v.nodeId][v.columnKey] = {
      value: v.value,
      contributedBy: v.contributedBy,
    };
  }

  return NextResponse.json({ values: shaped });
}

// PUT /api/crm/community-values
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { community_id, node_id, column_key, column_id, value } = body;

  if (!community_id || !node_id || !column_key || !column_id) {
    return NextResponse.json({ error: 'community_id, node_id, column_key, column_id required' }, { status: 400 });
  }

  const result = await prisma.communityColumnValue.upsert({
    where: {
      communityId_nodeId_columnKey: {
        communityId: community_id,
        nodeId: node_id,
        columnKey: column_key,
      },
    },
    update: {
      value: value ?? null,
      contributedById: session.userId,
    },
    create: {
      communityId: community_id,
      nodeId: node_id,
      columnKey: column_key,
      columnId: column_id,
      value: value ?? null,
      contributedById: session.userId,
    },
  });

  return NextResponse.json({ value: result });
}
