import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import prisma from '@/lib/prisma';

async function buildPrivateValues(userId: string, nodeIds: string[]): Promise<Record<string, Record<string, string | null>>> {
  // Get ALL user's private columns (global)
  const columns = await prisma.privateColumn.findMany({ where: { userId } });
  if (columns.length === 0) return {};

  const columnIds = columns.map((c) => c.id);

  const values = await prisma.privateColumnValue.findMany({
    where: {
      userId,
      columnId: { in: columnIds },
      ...(nodeIds.length > 0 ? { nodeId: { in: nodeIds } } : {}),
    },
  });

  // Shape: { [nodeId]: { [columnId]: value } }
  const shaped: Record<string, Record<string, string | null>> = {};
  for (const v of values) {
    if (!shaped[v.nodeId]) shaped[v.nodeId] = {};
    shaped[v.nodeId][v.columnId] = v.value;
  }
  return shaped;
}

// GET /api/crm/private-values?node_ids[]=A&node_ids[]=B
// Private values are global — no community_id filter needed.
// Optional community_id accepted for backwards compat but ignored.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const nodeIds = req.nextUrl.searchParams.getAll('node_ids[]');
  return NextResponse.json({ values: await buildPrivateValues(session.userId, nodeIds) });
}

// POST /api/crm/private-values  body: { node_ids: string[] }
// Same read as GET, but the id list rides in the body so fetching values for
// many nodes at once never blows past URL/header length limits.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const nodeIds: string[] = Array.isArray(body?.node_ids) ? body.node_ids : [];
  return NextResponse.json({ values: await buildPrivateValues(session.userId, nodeIds) });
}

// PUT /api/crm/private-values
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { node_id, column_id, value } = body;

  if (!node_id || !column_id) {
    return NextResponse.json({ error: 'node_id and column_id required' }, { status: 400 });
  }

  const column = await prisma.privateColumn.findUnique({ where: { id: column_id } });
  if (!column || column.userId !== session.userId) {
    return NextResponse.json({ error: 'Column not found' }, { status: 404 });
  }

  const result = await prisma.privateColumnValue.upsert({
    where: {
      userId_nodeId_columnId: {
        userId: session.userId,
        nodeId: node_id,
        columnId: column_id,
      },
    },
    update: { value: value ?? null },
    create: {
      userId: session.userId,
      nodeId: node_id,
      columnId: column_id,
      value: value ?? null,
    },
  });

  return NextResponse.json({ value: result });
}
