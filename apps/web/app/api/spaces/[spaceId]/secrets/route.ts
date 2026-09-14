import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { resolveContext } from '@/lib/notes/resolve';
import {
  setSpaceSecret,
  deleteSpaceSecret,
  listSecretNames,
  type SecretActor,
} from '@/lib/connectors/secretStore';

/**
 * Space connector secrets (admin only). Deliberately write-only: GET
 * returns names and timestamps, never values — a stored secret can be
 * overwritten or deleted but not read back. Values are only ever decrypted
 * server-side while executing a connector call (lib/connectors/service.ts).
 *
 * Every mutation goes through lib/connectors/secretStore.ts, the same module
 * the MCP `set_connector_secret` tool calls, so validation, encryption and the
 * audit line cannot drift between a browser admin and a token-holding client.
 * All this route adds is the browser half: the session that proves admin, and
 * the mapping from a store refusal to an HTTP status.
 */

/** The store wants both names; the session carries them under different keys. */
function actorOf(session: { userId: string; name: string; email: string }): SecretActor {
  return { userId: session.userId, name: session.name, email: session.email };
}

/**
 * The admin of the space these secrets belong to, or null.
 *
 * resolveContext rather than isAdmin(): a personal space holds no aliases and
 * never will, so its owner is its admin by definition — and that is the one
 * place that fact is written down. Storing the key for your own Google
 * connector goes through here like any other.
 */
async function adminSession(spaceId: string) {
  const session = await requireSession();
  if (session instanceof Response) return null;
  const resolved = await resolveContext(session, spaceId);
  if (resolved instanceof Response || !resolved.isAdmin) return null;
  return session;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  const { spaceId } = await params;
  const session = await adminSession(spaceId);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  return NextResponse.json({ secrets: await listSecretNames(spaceId) });
}

/**
 * Store or rotate one secret. `overwrite` is true here, unlike the MCP tool's
 * default: an admin typing into the connector page's Rotate field is looking at
 * the name they mean to replace and has already decided.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  const { spaceId } = await params;
  const session = await adminSession(spaceId);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await req.json()) as { name?: unknown; value?: unknown };
  const name = typeof body.name === 'string' ? body.name : '';
  const value = typeof body.value === 'string' ? body.value : '';

  const result = await setSpaceSecret(spaceId, actorOf(session), { name, value, overwrite: true });
  if (!result.ok) {
    // `unconfigured` is the server missing SECRETS_KEY, not the admin sending
    // something wrong — the only one of these that is a 5xx.
    return NextResponse.json(
      { error: result.error },
      { status: result.code === 'unconfigured' ? 500 : 400 }
    );
  }

  return NextResponse.json({ ok: true, name: result.name, rotated: result.rotated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  const { spaceId } = await params;
  const session = await adminSession(spaceId);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await req.json()) as { name?: unknown };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  await deleteSpaceSecret(spaceId, actorOf(session), name);
  return NextResponse.json({ ok: true });
}
