import { NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import prisma from '@/lib/prisma';
import { publicVapidKey } from '@/lib/webpush';

export async function GET() {
  return NextResponse.json({ publicKey: publicVapidKey() });
}

export async function POST(req: Request) {
  const user = await getApiMessagingUser();
  if (!user) return unauthorizedResponse();
  const body = await req.json().catch(() => null);
  if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
  }
  const userAgent = req.headers.get('user-agent');
  await prisma.pushSubscription.upsert({
    where: { endpoint: body.endpoint },
    create: {
      userId: user.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent,
    },
    update: { userId: user.id, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const user = await getApiMessagingUser();
  if (!user) return unauthorizedResponse();
  const { endpoint } = await req.json().catch(() => ({}));
  if (!endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
  await prisma.pushSubscription.deleteMany({ where: { userId: user.id, endpoint } });
  return NextResponse.json({ ok: true });
}
