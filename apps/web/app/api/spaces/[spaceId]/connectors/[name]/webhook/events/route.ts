/**
 * The last 50 deliveries a connector's webhook produced (`agent_events` rows
 * with `kind: webhook`), newest first — so an admin can see the hook is alive
 * and which agents heard it. Admin-only, like the address itself.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { resolveContext } from '@/lib/notes/resolve';
import { listWebhookEvents } from '@/lib/connectors/webhookInbound';

type Params = { params: Promise<{ spaceId: string; name: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { spaceId, name: raw } = await params;
  const session = await requireSession();
  if (session instanceof Response) return session;
  const resolved = await resolveContext(session, spaceId);
  if (resolved instanceof Response) return resolved;
  if (!resolved.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ events: await listWebhookEvents(spaceId, decodeURIComponent(raw), 50) });
}
