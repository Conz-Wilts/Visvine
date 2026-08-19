/**
 * Seeing and revoking the accounts a connector is connected to.
 *
 * A stored connection is a live credential to somebody else's service, so two
 * things have to be possible at all times: knowing it exists, and getting rid
 * of it. A `mode: space` connection matters most — it silently lends whoever
 * set it up to every member who can run the connector, and the only thing that
 * makes that honest is the account label being visible.
 *
 * GET     list connections. Admins see every one; a member sees only their own.
 * DELETE  disconnect. `?user=<id>` targets one; `?user=` (empty) the shared one.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { isAdmin } from '@/lib/auth';
import { principalOf, resolveContext } from '@/lib/notes/resolve';
import { describeConnector } from '@/lib/connectors/service';
import { deleteConnection, listConnections } from '@/lib/connectors/connections';

type Params = { params: Promise<{ spaceId: string; name: string }> };

/**
 * The connector must be visible to the caller before anything is said about it.
 * Otherwise this route would report which services a space has configured to
 * someone who cannot see the note.
 */
async function load(spaceId: string, name: string, session: { userId: string; email: string }) {
  const resolved = await resolveContext(session as never, spaceId);
  if (resolved instanceof Response) return { error: resolved };
  const principal = await principalOf(resolved);
  const detail = await describeConnector(principal, resolved, name);
  const auth = detail?.perimeter?.auth ?? null;
  if (!auth) {
    return { error: NextResponse.json({ error: 'No such OAuth connector' }, { status: 404 }) };
  }
  return { auth };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await requireSession();
  if (session instanceof Response) return session;
  const { spaceId, name } = await params;

  const loaded = await load(spaceId, name, session);
  if ('error' in loaded) return loaded.error;

  const admin = await isAdmin(session.userId, spaceId, session.email);
  const all = await listConnections(spaceId, loaded.auth.provider);

  // A member has no business knowing which of their colleagues connected an
  // account; they only need to know about the shared one and their own.
  const visible = admin ? all : all.filter((c) => c.userId === '' || c.userId === session.userId);

  return NextResponse.json({
    provider: loaded.auth.provider,
    mode: loaded.auth.mode,
    connections: visible.map((c) => ({
      mode: c.mode,
      // `actsAs` is the point of this endpoint: a shared connection must never
      // be able to look like "your account" in a UI.
      actsAs: c.accountLabel,
      isMine: c.userId === session.userId,
      isShared: c.userId === '',
      scopes: c.scopes,
      expiresAt: c.expiresAt,
      broken: c.broken,
      connectedAt: c.connectedAt,
      connectedBy: admin ? c.connectedBy : null,
      // The DELETE target. Only an admin may revoke somebody else's, so only an
      // admin is told which id a row belongs to.
      userId: admin ? c.userId : null,
    })),
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await requireSession();
  if (session instanceof Response) return session;
  const { spaceId, name } = await params;

  const loaded = await load(spaceId, name, session);
  if ('error' in loaded) return loaded.error;

  const target = req.nextUrl.searchParams.get('user') ?? session.userId;

  // Anyone may revoke their own. Removing the shared connection, or somebody
  // else's, breaks other people's runs and every agent pointed at it — so that
  // is an admin act.
  if (target !== session.userId && !(await isAdmin(session.userId, spaceId, session.email))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await deleteConnection(spaceId, loaded.auth.provider, target);
  return NextResponse.json({ ok: true });
}
