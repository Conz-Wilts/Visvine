import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api/route';
import { resolvePersonalContext } from '@/lib/notes/resolve';

/**
 * GET: the id of the caller's personal space, provisioning it if this is the
 * first time they have needed it.
 *
 * The id is derivable (`me:<userId>`), but a client that derives it can ask for
 * a space that does not exist yet — personal spaces are created lazily, and
 * every space-scoped route 404s on one that has not been. So the surfaces that
 * work against your own space (Settings → Connectors) ask here first and get
 * back an id that is real by the time they hold it.
 */
export async function GET() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const context = await resolvePersonalContext({
    userId: session.userId,
    name: session.name,
    email: session.email,
  });

  return NextResponse.json({ spaceId: context.spaceId });
}
