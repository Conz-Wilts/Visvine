import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { resolveBrain, principalOf } from '@/lib/notes/brain';
import { aiConfigured } from '@/lib/notes/ai';
import { runConnectorAgent } from '@/lib/connectors/agent';

/**
 * The "describe it" creation agent: POST { prompt } and the server-side tool
 * loop researches, writes the connector note and (when its secrets are already
 * stored) probes it in the sandbox until a call works. Progress streams back
 * as NDJSON — one AgentEvent per line — so the panel can narrate the build.
 *
 * Admin-only, same as every other connector write. The agent acts AS the
 * admin's principal: its note writes go through writeGated and its probes
 * through executeConnectorScript, so nothing here widens what the console
 * itself could do.
 */

export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ communityId: string }> }
) {
  const { communityId } = await params;
  const session = await requireSession();
  if (session instanceof Response) return session;

  const resolved = await resolveBrain(session, communityId);
  if (resolved instanceof Response) return resolved;
  if (!resolved.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!aiConfigured()) {
    return NextResponse.json(
      { error: 'AI is not configured: set GEMINI_API_KEY.' },
      { status: 501 },
    );
  }

  let body: { prompt?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    return NextResponse.json({ error: 'Send { prompt } — describe what to connect' }, { status: 400 });
  }

  const principal = await principalOf(resolved);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: unknown) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      try {
        await runConnectorAgent({ principal, brain: resolved, communityId }, prompt, emit);
      } catch (e) {
        emit({ type: 'error', message: e instanceof Error ? e.message : 'Agent failed' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
