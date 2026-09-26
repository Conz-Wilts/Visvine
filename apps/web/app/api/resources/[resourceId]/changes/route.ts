import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiSession, handleApiError } from '@/lib/api/route';
import { requireVisibleResource } from '@/lib/resources/visibility';

async function assertMember(resourceId: string, userId: string, email?: string | null) {
  try {
    const resource = await requireVisibleResource(resourceId, userId, email);
    return { resource };
  } catch (err) {
    return { error: handleApiError(err, 'resources.review.gate') };
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ resourceId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { resourceId } = await params;
  const check = await assertMember(resourceId, session.userId, session.email);
  if (check.error) return check.error;

  const status = req.nextUrl.searchParams.get('status') ?? undefined;
  const where: Record<string, string> = { resourceId };
  if (status) where.status = status;
  const changes = await prisma.resourceChange.findMany({ where, orderBy: { createdAt: 'desc' } });
  return NextResponse.json(changes);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ resourceId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { resourceId } = await params;
  const check = await assertMember(resourceId, session.userId, session.email);
  if (check.error) return check.error;

  const body = await req.json();
  const change = await prisma.resourceChange.create({
    data: {
      resourceId,
      cellRef: body.cellRef,
      originalValue: body.originalValue ?? null,
      proposedValue: body.proposedValue,
      reason: body.reason ?? null,
      proposedBy: session.userId,
    },
  });
  return NextResponse.json(change);
}
