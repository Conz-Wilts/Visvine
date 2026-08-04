import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { resolveBrain, principalOf } from '@/lib/notes/brain';
import { executeHttpConnector } from '@/lib/connectors/http';
import { executePostgresQuery } from '@/lib/connectors/postgres';
import { executeMysqlQuery } from '@/lib/connectors/mysql';
import { callMcpTool, listMcpTools } from '@/lib/connectors/mcp';
import {
  configSecretRefs,
  ConnectorError,
  findSecretRefs,
  interpolateSecrets,
  type ConnectorErrorCode,
} from '@/lib/connectors/config';
import {
  auditConnectorCall,
  loadConnector,
  resolveSecretValues,
} from '@/lib/connectors/service';

/**
 * Run one connector call as the admin, from the connector's page — the same
 * executors, allowlist and secret resolution an agent's call_connector /
 * query_connector goes through, so a green result here means the agent's call
 * will work and a red one names the thing to fix.
 *
 * Deliberately not a thinner path than the MCP tools: no bypass of the
 * allowlist, no admin-only widening, and the call is audited like any other.
 * The only difference is who asked.
 */

/** ConnectorError codes → the status that says the same thing over HTTP. */
const STATUS_BY_CODE: Record<ConnectorErrorCode, number> = {
  denied: 403,
  config: 400,
  missing_secret: 400,
  ssrf: 400,
  timeout: 504,
  upstream: 502,
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ communityId: string; name: string }> }
) {
  const { communityId, name } = await params;
  const session = await requireSession();
  if (session instanceof Response) return session;

  const resolved = await resolveBrain(session, communityId);
  if (resolved instanceof Response) return resolved;
  if (!resolved.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: {
    method?: unknown;
    path?: unknown;
    query?: unknown;
    sql?: unknown;
    body?: unknown;
    tool?: unknown;
    arguments?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const principal = await principalOf(resolved);
  let loaded;
  try {
    loaded = await loadConnector(principal, resolved, decodeURIComponent(name));
  } catch (e) {
    // A note that exists but doesn't parse — the page already shows the error;
    // running against it is a 400, not a crash.
    const message = e instanceof ConnectorError ? e.message : 'Connector could not be loaded';
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (!loaded) return NextResponse.json({ error: 'Connector not found' }, { status: 404 });

  const describe = (detail: string) => auditConnectorCall(principal, loaded.path, `${detail} (test)`);

  try {
    if (loaded.config.alias === 'http') {
      const method = typeof body.method === 'string' ? body.method : 'GET';
      const path = typeof body.path === 'string' ? body.path : '';
      const query =
        body.query && typeof body.query === 'object' && !Array.isArray(body.query)
          ? Object.fromEntries(
              Object.entries(body.query as Record<string, unknown>)
                .filter(([, v]) => typeof v === 'string')
                .map(([k, v]) => [k, v as string]),
            )
          : undefined;
      const secrets = await resolveSecretValues(communityId, configSecretRefs(loaded.config));
      const result = await executeHttpConnector(loaded.config, secrets, {
        method,
        path,
        query,
        body: typeof body.body === 'string' && body.body.length > 0 ? body.body : undefined,
      });
      describe(`${method.toUpperCase()} ${path} → ${result.status}`);
      return NextResponse.json({ kind: 'http', result });
    }

    if (loaded.config.alias === 'mcp') {
      const secrets = await resolveSecretValues(communityId, configSecretRefs(loaded.config));
      // No tool named = discovery; the page's tester lists before it calls.
      if (typeof body.tool !== 'string' || !body.tool) {
        const tools = await listMcpTools(loaded.config, secrets);
        describe(`tools/list → ${tools.length} tools`);
        return NextResponse.json({ kind: 'mcp', result: { tools } });
      }
      const args =
        body.arguments && typeof body.arguments === 'object' && !Array.isArray(body.arguments)
          ? (body.arguments as Record<string, unknown>)
          : {};
      const result = await callMcpTool(loaded.config, secrets, body.tool, args);
      describe(`tools/call ${body.tool} → ${result.is_error ? 'error' : 'ok'}`);
      return NextResponse.json({ kind: 'mcp', result });
    }

    const config = loaded.config;
    const sql = typeof body.sql === 'string' ? body.sql : '';
    const secrets = await resolveSecretValues(communityId, findSecretRefs(config.dsn));
    const dsn = interpolateSecrets(config.dsn, secrets);
    if (!dsn.ok) {
      throw new ConnectorError('missing_secret', `Secret ${dsn.missing.join(', ')} not set`);
    }
    const result =
      config.alias === 'postgres'
        ? await executePostgresQuery(config, dsn.value, sql)
        : await executeMysqlQuery(config, dsn.value, sql);
    describe(`query → ${result.row_count} rows`);
    return NextResponse.json({ kind: config.alias, result });
  } catch (e) {
    if (e instanceof ConnectorError) {
      describe(`${e.code}: ${e.message}`);
      return NextResponse.json({ error: e.message, code: e.code }, { status: STATUS_BY_CODE[e.code] });
    }
    throw e;
  }
}
