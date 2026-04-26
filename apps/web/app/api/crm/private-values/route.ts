import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import prisma from '@/lib/prisma';

// GET /api/crm/private-values?node_ids[]=A&node_ids[]=B
// Private values are global — no community_id filter needed.
// Optional community_id accepted for backwards compat but ignored.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const nodeIds = req.nextUrl.searchParams.getAll('node_ids[]');

  // Get ALL user's private columns (global)
  const columns = await prisma.privateColumn.findMany({
    where: { userId: session.userId },
  });

  if (columns.length === 0) return NextResponse.json({ values: {} });

  const columnIds = columns.map((c) => c.id);

  const values = await prisma.privateColumnValue.findMany({
    where: {
      userId: session.userId,
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

  return NextResponse.json({ values: shaped });
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
