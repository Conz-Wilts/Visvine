import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession as requireAdmin } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logActivity } from '@/lib/activityLog';
import { encryptSecret } from '@/lib/crypto/secrets';
import { isValidSecretName } from '@/lib/connectors/config';

/**
 * Community connector secrets (admin only). Deliberately write-only: GET
 * returns names and timestamps, never values — a stored secret can be
 * overwritten or deleted but not read back. Values are only ever decrypted
 * server-side while executing a connector call (lib/connectors/service.ts).
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ communityId: string }> }
) {
  const { communityId } = await params;
  const session = await requireAdmin(communityId);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const rows = await prisma.communitySecret.findMany({
    where: { communityId },
    select: { name: true, createdBy: true, updatedAt: true },
    orderBy: { name: 'asc' },
  });
  return NextResponse.json({ secrets: rows });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ communityId: string }> }
) {
  const { communityId } = await params;
  const session = await requireAdmin(communityId);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await req.json()) as { name?: unknown; value?: unknown };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const value = typeof body.value === 'string' ? body.value : '';
  if (!isValidSecretName(name)) {
    return NextResponse.json(
      { error: 'Secret names are UPPER_SNAKE_CASE: start with A-Z, then A-Z, 0-9 or _ (max 64 chars)' },
      { status: 400 }
    );
  }
  if (value.length === 0 || value.length > 8192) {
    return NextResponse.json({ error: 'Secret value must be 1–8192 characters' }, { status: 400 });
  }

  let ciphertext: string;
  try {
    ciphertext = encryptSecret(value);
  } catch {
    return NextResponse.json(
      { error: 'Connector secrets are not configured on this server (SECRETS_KEY)' },
      { status: 500 }
    );
  }

  await prisma.communitySecret.upsert({
    where: { secret_identity: { communityId, name } },
    create: { communityId, name, ciphertext, createdBy: session.email },
    update: { ciphertext, createdBy: session.email },
  });

  await logActivity({
    communityId,
    actorEmail: session.email,
    actorName: session.name,
    action: 'secret_set',
    details: { name },
  });

  return NextResponse.json({ ok: true, name });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ communityId: string }> }
) {
  const { communityId } = await params;
  const session = await requireAdmin(communityId);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await req.json()) as { name?: unknown };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  await prisma.communitySecret.deleteMany({ where: { communityId, name } });

  await logActivity({
    communityId,
    actorEmail: session.email,
    actorName: session.name,
    action: 'secret_deleted',
    details: { name },
  });

  return NextResponse.json({ ok: true });
}
