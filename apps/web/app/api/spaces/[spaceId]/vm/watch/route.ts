import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession as requireAdmin } from '@/lib/auth';
import { mintWatchTicket, watchUrl } from '@/lib/vm/watch';
import { environment } from '@/lib/vm/lease';

/**
 * A ticket to watch one machine, and the socket URL to spend it on.
 *
 * The person is authorized here — session, space, admin, exactly as the machine
 * itself is — and what the browser receives is good for sixty seconds and one
 * machine. It is deliberately not the service token: that one opens every
 * machine on the platform, and a browser is the last place it should be.
 *
 * Watching is admin-only for the same reason running a command is: a machine
 * holds the space's reach, and its terminal shows whatever the agent is doing
 * with it.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  const { spaceId } = await params;
  const session = await requireAdmin(spaceId);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(_req.url);
  const agent = searchParams.get('agent')?.trim();
  if (!agent) return NextResponse.json({ error: 'agent is required' }, { status: 400 });

  const edge = process.env.AGENT_EDGE_URL;
  const secret = process.env.EDGE_SERVICE_TOKEN;
  if (!edge || !secret) {
    return NextResponse.json({ error: 'This deployment has no agent machines configured.' }, { status: 503 });
  }

  const env = environment();
  const ticket = mintWatchTicket(env, spaceId, agent, secret);
  return NextResponse.json({ url: watchUrl(edge, env, spaceId, agent, ticket), expiresInSeconds: 60 });
}
