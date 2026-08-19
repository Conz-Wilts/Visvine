/**
 * Inbound webhook address: `POST /api/hooks/<space>/<connector>/<token>`.
 *
 * Public (no session — a provider is calling; listed under `/api/hooks` in
 * proxy.ts). Everything that makes that safe lives in
 * lib/connectors/webhookInbound.ts: the URL token, the note's declared
 * signature scheme, the rate bucket, the size cap. This file only routes.
 */
import type { NextRequest } from 'next/server';
import { handleInboundWebhook } from '@/lib/connectors/webhookInbound';

// Raw body access + no caching: a delivery is a one-off.
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ spaceId: string; connector: string; token: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { spaceId, connector, token } = await params;
  return handleInboundWebhook(req, {
    spaceId: decodeURIComponent(spaceId),
    connector: decodeURIComponent(connector),
    token: decodeURIComponent(token),
  });
}

/** Providers sometimes probe the address; answer without saying anything. */
export async function GET() {
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'content-type': 'application/json', allow: 'POST' },
  });
}
