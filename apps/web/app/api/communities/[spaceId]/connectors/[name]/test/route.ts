import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { resolveContext, principalOf } from '@/lib/notes/resolve';
import { ConnectorError, type ConnectorErrorCode } from '@/lib/connectors/config';
import { executeConnectorScript, loadConnector } from '@/lib/connectors/service';

/**
 * Run one script in the connector's isolate as the admin, from the console on
 * the connector's page — the exact path an agent's run_connector takes: same
 * perimeter, same secret resolution, same redaction, same audit line. A green
 * run here means the agent's run will work and a red one names the thing to
 * fix.
 *
 * Deliberately not a thinner path than the MCP tool: no perimeter bypass, no
 * admin-only widening. The only difference is who asked.
 */

/** ConnectorError codes → the status that says the same thing over HTTP. */
const STATUS_BY_CODE: Record<ConnectorErrorCode, number> = {
  denied: 403,
  config: 400,
  missing_secret: 400,
  ssrf: 400,
  timeout: 504,
  upstream: 502,
  rate_limited: 429,
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string; name: string }> }
) {
  const { spaceId, name } = await params;
  const session = await requireSession();
  if (session instanceof Response) return session;

  const resolved = await resolveContext(session, spaceId);
  if (resolved instanceof Response) return resolved;
  if (!resolved.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { code?: unknown; action?: unknown; args?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const hasCode = typeof body.code === 'string' && body.code.trim().length > 0;
  const hasAction = typeof body.action === 'string' && body.action.trim().length > 0;
  if (hasCode === hasAction) {
    return NextResponse.json(
      { error: 'Send { code } — JavaScript to evaluate — or { action, args } for a declared action' },
      { status: 400 },
    );
  }
  const run = hasAction
    ? { action: (body.action as string).trim(), args: body.args ?? {} }
    : { code: body.code as string };

  const principal = await principalOf(resolved);
  let loaded;
  try {
    // Space-only: this is the page for one note, and running it must test
    // THAT connector rather than a same-named one of the admin's own.
    loaded = await loadConnector(principal, resolved, decodeURIComponent(name), { personal: false });
  } catch (e) {
    // A note that exists but doesn't parse — the page already shows the error;
    // running against it is a 400, not a crash.
    const message = e instanceof ConnectorError ? e.message : 'Connector could not be loaded';
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (!loaded) return NextResponse.json({ error: 'Connector not found' }, { status: 404 });

  try {
    const result = await executeConnectorScript(loaded, run);
    return NextResponse.json({
      result: {
        ok: result.ok,
        value: result.value,
        logs: result.logs,
        error: result.error,
        truncated: result.truncated,
        timed_out: result.timedOut,
        denials: result.denials,
        duration_ms: result.durationMs,
      },
    });
  } catch (e) {
    if (e instanceof ConnectorError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: STATUS_BY_CODE[e.code] });
    }
    throw e;
  }
}
