import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getAdminSession as requireAdmin } from '@/lib/auth';
import prisma from '@/lib/prisma';

function inviteUrl(req: NextRequest, token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  return `${base.replace(/\/$/, '')}/invite/${token}`;
}

/**
 * GET: Return the community's current invite link (admin only). Lazily generates
 * an invite token the first time it's requested for communities that predate the
 * feature.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params;

  const session = await requireAdmin(communityId);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { inviteToken: true },
  });
  if (!community) {
    return NextResponse.json({ error: 'Community not found' }, { status: 404 });
  }

  let token = community.inviteToken;
  if (!token) {
    token = randomUUID();
    await prisma.community.update({ where: { id: communityId }, data: { inviteToken: token } });
  }

  return NextResponse.json({ token, url: inviteUrl(req, token) });
}

/**
 * POST: Regenerate the invite token (admin only), invalidating the previous link.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params;

  const session = await requireAdmin(communityId);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const token = randomUUID();
  const updated = await prisma.community
    .update({ where: { id: communityId }, data: { inviteToken: token }, select: { id: true } })
    .catch(() => null);
  if (!updated) {
    return NextResponse.json({ error: 'Community not found' }, { status: 404 });
  }

  return NextResponse.json({ token, url: inviteUrl(req, token) });
}
