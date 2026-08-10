import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api/route';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/prisma';

// GET /api/crm/value-share-requests?community_id=X
export async function GET(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const communityId = req.nextUrl.searchParams.get('community_id');
  if (!communityId) return NextResponse.json({ error: 'community_id required' }, { status: 400 });

  const admin = await isAdmin(session.userId, communityId, session.email);

  const requests = await prisma.valueShareRequest.findMany({
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

// POST /api/crm/value-share-requests
export async function POST(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const body = await req.json();
  const { community_id, node_id, column_key, column_name, column_type, value } = body;

  if (!community_id || !node_id || !column_key || !column_name || !column_type) {
    return NextResponse.json({ error: 'community_id, node_id, column_key, column_name, column_type required' }, { status: 400 });
  }

  const membership = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId: session.userId, communityId: community_id } },
  });
  if (!membership) return NextResponse.json({ error: 'Not a member of this community' }, { status: 403 });

  // Prevent duplicate pending requests
  const existing = await prisma.valueShareRequest.findFirst({
    where: {
      requesterId: session.userId,
      communityId: community_id,
      nodeId: node_id,
      columnKey: column_key,
      status: 'pending',
    },
  });
  if (existing) return NextResponse.json({ error: 'A pending request already exists for this value' }, { status: 409 });

  const request = await prisma.valueShareRequest.create({
    data: {
      requesterId: session.userId,
      communityId: community_id,
      nodeId: node_id,
      columnKey: column_key,
      columnName: column_name,
      columnType: column_type,
      value: value ?? null,
    },
    include: {
      requester: { select: { id: true, name: true, image: true } },
    },
  });

  return NextResponse.json({ request });
}

// PUT /api/crm/value-share-requests — admin approve/reject
export async function PUT(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const body = await req.json();
  const { id, status, reviewer_note } = body;

  if (!id || !status || !['approved', 'rejected'].includes(status)) {
    return NextResponse.json({ error: 'id and valid status (approved|rejected) required' }, { status: 400 });
  }

  const requestRecord = await prisma.valueShareRequest.findUnique({ where: { id } });
  if (!requestRecord) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const admin = await isAdmin(session.userId, requestRecord.communityId, session.email);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const updated = await prisma.valueShareRequest.update({
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
    // Find or create the community column
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
          position: count,
        },
      });
    } else {
      communityColumn = existing;
    }

    // Upsert the community value
    await prisma.communityColumnValue.upsert({
      where: {
        communityId_nodeId_columnKey: {
          communityId: requestRecord.communityId,
          nodeId: requestRecord.nodeId,
          columnKey: requestRecord.columnKey,
        },
      },
      update: {
        value: requestRecord.value,
        contributedById: requestRecord.requesterId,
      },
      create: {
        communityId: requestRecord.communityId,
        nodeId: requestRecord.nodeId,
        columnKey: requestRecord.columnKey,
        columnId: communityColumn.id,
        value: requestRecord.value,
        contributedById: requestRecord.requesterId,
      },
    });
  }

  return NextResponse.json({ request: updated, communityColumn });
}
