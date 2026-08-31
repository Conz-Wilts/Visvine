import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { resolveContext } from '@/lib/notes/resolve';
import { deliverMessage } from '@/lib/agents/channels';
import { clean, MAX_BODY, MAX_SUBJECT } from '@/lib/agents/shared/channels';

const bodySchema = z.object({
  text: z.string().min(1).max(MAX_BODY),
  subject: z.string().max(MAX_SUBJECT).optional(),
});

/**
 * Say something to an agent, from inside the app.
 *
 * The in-app channel, and the simplest of the three: the session already says
 * who this is, so there is no address to parse and no sender to match. It still
 * goes through the same delivery path as an email or a Slack mention — the
 * message lands in the agent's mailbox and the ordinary tick runs it — because
 * one loop behind every channel is the property worth keeping.
 *
 * The reply arrives the way an agent's work always does: on its timeline and
 * in the notes it writes.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string; name: string }> }
) {
  const { spaceId, name } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const resolved = await resolveContext(session, spaceId);
  if (resolved instanceof Response) return resolved;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'text is required' }, { status: 400 });

  const result = await deliverMessage({
    channel: 'in_app',
    spaceId,
    agentName: name,
    from: { email: session.email, display: session.name },
    subject: clean(parsed.data.subject ?? parsed.data.text, MAX_SUBJECT),
    body: clean(parsed.data.text, MAX_BODY),
    // The session's own message id: one send is one message, and a double-click
    // is deduped by the mailbox rather than by us guessing.
    externalId: `${session.userId}:${Date.now()}`,
  });

  if (!result.ok) {
    const status = result.reason === 'not_a_member' ? 403 : result.reason === 'dropped' ? 409 : 404;
    return NextResponse.json({ error: result.message }, { status });
  }
  return NextResponse.json({ ok: true, agent: result.agentName, eventId: result.eventId });
}
