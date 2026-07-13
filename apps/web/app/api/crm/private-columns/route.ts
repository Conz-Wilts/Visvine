import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import prisma from '@/lib/prisma';

// GET /api/crm/private-columns — returns ALL user's global private columns
// Optional: ?community_id=X for backwards compat (filters to that community's legacy columns too)
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const columns = await prisma.privateColumn.findMany({
    where: { userId: session.userId },
    orderBy: { position: 'asc' },
  });

  return NextResponse.json({ columns });
}

// POST /api/crm/private-columns
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { column_name, column_type, options, community_id } = body;

  if (!column_name || !column_type) {
    return NextResponse.json({ error: 'column_name, column_type required' }, { status: 400 });
  }

  const columnKey = `${column_name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')}_${Date.now()}`;

  const count = await prisma.privateColumn.count({
    where: { userId: session.userId },
  });

  const column = await prisma.privateColumn.create({
    data: {
      userId: session.userId,
      communityId: community_id ?? null,
      columnKey,
      columnName: column_name,
      columnType: column_type,
      options: options ?? undefined,
      position: count,
    },
  });

  return NextResponse.json({ column });
}

// DELETE /api/crm/private-columns?id=X
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const column = await prisma.privateColumn.findUnique({ where: { id } });
  if (!column || column.userId !== session.userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await prisma.privateColumn.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

// PATCH /api/crm/private-columns
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id, column_name, options } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const column = await prisma.privateColumn.findUnique({ where: { id } });
  if (!column || column.userId !== session.userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const updated = await prisma.privateColumn.update({
    where: { id },
    data: {
      ...(column_name ? { columnName: column_name } : {}),
      ...(options !== undefined ? { options } : {}),
    },
  });

  return NextResponse.json({ column: updated });
}
