import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import prisma from '@/lib/prisma';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const user = await getApiMessagingUser();
  if (!user) return unauthorizedResponse();
  const { userId } = await params;
  if (userId === user.id) return NextResponse.json({ error: 'Cannot block yourself' }, { status: 400 });
  await prisma.userBlock.upsert({
    where: { blockerId_blockedId: { blockerId: user.id, blockedId: userId } },
    create: { blockerId: user.id, blockedId: userId },
    update: {},
  });
  return NextResponse.json({ blocked: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const user = await getApiMessagingUser();
  if (!user) return unauthorizedResponse();
  const { userId } = await params;
  await prisma.userBlock.deleteMany({ where: { blockerId: user.id, blockedId: userId } });
  return NextResponse.json({ blocked: false });
}
