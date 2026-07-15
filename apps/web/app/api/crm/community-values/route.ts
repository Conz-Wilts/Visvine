import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api/route';
import prisma from '@/lib/prisma';

type CommunityValueMap = Record<string, Record<string, { value: string | null; contributedBy: { id: string; name: string; image: string | null } | null }>>;

async function buildCommunityValues(communityId: string, nodeIds: string[]): Promise<CommunityValueMap> {
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
  const shaped: CommunityValueMap = {};
  for (const v of values) {
    if (!shaped[v.nodeId]) shaped[v.nodeId] = {};
    shaped[v.nodeId][v.columnKey] = {
      value: v.value,
      contributedBy: v.contributedBy,
    };
  }
  return shaped;
}

// GET /api/crm/community-values?community_id=X&node_ids[]=A
// Requires an authenticated session (symmetric with POST/PUT and the
// private-values route). No per-community membership gate: communities are
// publicly browsable, so the community directory layer is readable by any
// signed-in user.
export async function GET(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const communityId = req.nextUrl.searchParams.get('community_id');
  const nodeIds = req.nextUrl.searchParams.getAll('node_ids[]');

  if (!communityId) return NextResponse.json({ error: 'community_id required' }, { status: 400 });

  return NextResponse.json({ values: await buildCommunityValues(communityId, nodeIds) });
}

// POST /api/crm/community-values  body: { community_id, node_ids: string[] }
// Same read as GET, but the id list rides in the body so fetching values for
// many nodes at once never blows past URL/header length limits.
export async function POST(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const body = await req.json().catch(() => null);
  const communityId: unknown = body?.community_id;
  const nodeIds: string[] = Array.isArray(body?.node_ids) ? body.node_ids : [];

  if (typeof communityId !== 'string' || !communityId) {
    return NextResponse.json({ error: 'community_id required' }, { status: 400 });
  }

  return NextResponse.json({ values: await buildCommunityValues(communityId, nodeIds) });
}

// PUT /api/crm/community-values
export async function PUT(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

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
