/**
 * The admin side of a connector's inbound address.
 *
 * GET     the URL (minting the token on first read), the declared signature
 *         scheme, whether its secret is stored, and which agents listen.
 * DELETE  rotate — the old URL stops working at once, and the new one is returned.
 *
 * Admin-only: the URL is a credential (anyone holding it can post into the
 * space's agents), which is why it is never part of the connector GET a member
 * can read.
 */
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireSession } from '@/lib/session';
import { principalOf, resolveContext } from '@/lib/notes/resolve';
import { describeConnector } from '@/lib/connectors/service';
import { webhookRecipients } from '@/lib/agents/events';
import {
  ensureWebhookToken,
  provisionWebhookToken,
  webhookUrl,
} from '@/lib/connectors/webhookInbound';
import type { ConnectorWebhook } from '@/lib/connectors/webhook';

type Params = { params: Promise<{ spaceId: string; name: string }> };

async function loadForAdmin(spaceId: string, name: string) {
  const session = await requireSession();
  if (session instanceof Response) return { error: session };
  const resolved = await resolveContext(session, spaceId);
  if (resolved instanceof Response) return { error: resolved };
  if (!resolved.isAdmin) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  const principal = await principalOf(resolved);
  const detail = await describeConnector(principal, resolved, name);
  const webhook = detail?.perimeter?.webhook ?? null;
  if (!webhook) return { error: NextResponse.json({ error: 'This connector has no webhook block' }, { status: 404 }) };
  return { session, webhook };
}

async function describe(spaceId: string, name: string, token: string, webhook: ConnectorWebhook) {
  const hasSignatureSecret = webhook.secretName
    ? (await prisma.connectorSecret.count({ where: { spaceId, name: webhook.secretName } })) > 0
    : false;
  return {
    url: webhookUrl(spaceId, name, token),
    signature: webhook.signature,
    header: webhook.header,
    idHeader: webhook.idHeader,
    eventField: webhook.eventField,
    maxBytes: webhook.maxBytes,
    secretName: webhook.secretName,
    hasSignatureSecret,
    recipients: await webhookRecipients(spaceId, name),
  };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { spaceId, name: raw } = await params;
  const name = decodeURIComponent(raw);
  const loaded = await loadForAdmin(spaceId, name);
  if ('error' in loaded) return loaded.error;
  const token = await ensureWebhookToken(spaceId, name, loaded.session.email ?? null);
  return NextResponse.json(await describe(spaceId, name, token, loaded.webhook));
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { spaceId, name: raw } = await params;
  const name = decodeURIComponent(raw);
  const loaded = await loadForAdmin(spaceId, name);
  if ('error' in loaded) return loaded.error;
  const token = await provisionWebhookToken(spaceId, name, loaded.session.email ?? null);
  return NextResponse.json({ rotated: true, ...(await describe(spaceId, name, token, loaded.webhook)) });
}
