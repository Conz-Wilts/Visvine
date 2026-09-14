import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getAdminSession as requireAdmin } from '@/lib/auth';
import prisma from '@/lib/prisma';

function inviteUrl(req: NextRequest, token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  return `${base.replace(/\/$/, '')}/invite/${token}`;
}

/**
 * GET: Return the space's current invite link (admin only). Lazily generates
 * an invite token the first time it's requested for spaces that predate the
 * feature.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;

  const session = await requireAdmin(spaceId);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { inviteToken: true },
  });
  if (!space) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 });
  }

  let token = space.inviteToken;
  if (!token) {
    token = randomUUID();
    await prisma.space.update({ where: { id: spaceId }, data: { inviteToken: token } });
  }

  return NextResponse.json({ token, url: inviteUrl(req, token) });
}

/**
 * POST: Regenerate the invite token (admin only), invalidating the previous link.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;

  const session = await requireAdmin(spaceId);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const token = randomUUID();
  const updated = await prisma.space
    .update({ where: { id: spaceId }, data: { inviteToken: token }, select: { id: true } })
    .catch(() => null);
  if (!updated) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 });
  }

  return NextResponse.json({ token, url: inviteUrl(req, token) });
}
