import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/prisma';

// GET /api/crm/column-requests?community_id=X
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const communityId = req.nextUrl.searchParams.get('community_id');
  if (!communityId) return NextResponse.json({ error: 'community_id required' }, { status: 400 });

  const admin = await isAdmin(session.userId, communityId, session.email);

  const requests = await prisma.communityColumnRequest.findMany({
    where: {
      communityId,
      ...(admin ? {} : { requesterId: session.userId }),
    },
    include: {
      requester: { select: { id: true, name: true, image: true } },
      reviewer: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ requests, isAdmin: admin });
}

// POST /api/crm/column-requests
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { community_id, column_name, column_type, options, description, from_private_column_id } = body;

  if (!community_id || !column_name || !column_type) {
    return NextResponse.json({ error: 'community_id, column_name, column_type required' }, { status: 400 });
  }

  const columnKey = `${column_name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')}`;

  const request = await prisma.communityColumnRequest.create({
    data: {
      communityId: community_id,
      requesterId: session.userId,
      columnKey,
      columnName: column_name,
      columnType: column_type,
      options: options ?? undefined,
      description: description ?? null,
    },
    include: {
      requester: { select: { id: true, name: true, image: true } },
    },
  });

  return NextResponse.json({ request, fromPrivateColumnId: from_private_column_id ?? null });
}

// PUT /api/crm/column-requests — admin approve/reject
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id, status, reviewer_note } = body;

  if (!id || !status || !['approved', 'rejected'].includes(status)) {
    return NextResponse.json({ error: 'id and valid status (approved|rejected) required' }, { status: 400 });
  }

  const requestRecord = await prisma.communityColumnRequest.findUnique({ where: { id } });
  if (!requestRecord) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const admin = await isAdmin(session.userId, requestRecord.communityId, session.email);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const updated = await prisma.communityColumnRequest.update({
    where: { id },
    data: {
      status,
      reviewerId: session.userId,
      reviewerNote: reviewer_note ?? null,
      reviewedAt: new Date(),
    },
  });

  let communityColumn = null;
  if (status === 'approved') {
    const existing = await prisma.communityColumn.findUnique({
      where: {
        communityId_columnKey: {
          communityId: requestRecord.communityId,
          columnKey: requestRecord.columnKey,
        },
      },
    });

    if (!existing) {
      const count = await prisma.communityColumn.count({
        where: { communityId: requestRecord.communityId },
      });

      communityColumn = await prisma.communityColumn.create({
        data: {
          communityId: requestRecord.communityId,
          columnKey: requestRecord.columnKey,
          columnName: requestRecord.columnName,
          columnType: requestRecord.columnType,
          options: requestRecord.options ?? undefined,
          position: count,
          createdFromRequestId: requestRecord.id,
        },
      });

      // Seed from requester's private column values
      const privateColumn = await prisma.privateColumn.findFirst({
        where: {
          userId: requestRecord.requesterId,
          communityId: requestRecord.communityId,
          columnName: requestRecord.columnName,
        },
        include: { values: true },
      });

      if (privateColumn && privateColumn.values.length > 0) {
        await prisma.communityColumnValue.createMany({
          data: privateColumn.values.map((v) => ({
            communityId: requestRecord.communityId,
            nodeId: v.nodeId,
            columnKey: requestRecord.columnKey,
            columnId: communityColumn!.id,
            value: v.value,
            contributedById: requestRecord.requesterId,
          })),
          skipDuplicates: true,
        });
      }
    } else {
      communityColumn = existing;
    }
  }

  return NextResponse.json({ request: updated, communityColumn });
}
