/**
 * End-to-end proof that an MCP client can pull fund metrics through a
 * connector — the full stack, no shortcuts:
 *
 *   real MCP client → Streamable HTTP → /api/mcp → bearer + scope gate →
 *   visibility lens → perimeter parse → secret decrypt → sandbox →
 *   fetch to the fund-metrics API → redaction → back over the wire
 *
 * Unlike scripts/verify-connectors-demo.ts (which calls the service layer
 * directly), this one goes over the actual MCP transport, so the token, the
 * scope check and the tool schemas are all exercised too.
 *
 * Needs `pnpm dev` running and `pnpm db:connectors:funds` seeded.
 *
 *   pnpm connectors:verify:funds [spaceId]
 */
import 'dotenv/config';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import prisma from '../lib/prisma';
import { OWNER_ALIAS_ID } from '../lib/types/context';
import { mintAccessToken } from '../lib/mcp/tokens';
import { MCP_SCOPES } from '../lib/mcp/scopes';

const SPACE = process.argv[2] ?? 'community:blackbird-ventures';
const APP = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const MCP_URL = new URL(`${APP}/api/mcp`);

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n        ${detail.slice(0, 400)}`);
  if (ok) pass++;
  else fail++;
}

/**
 * A tool result's text payload, parsed. Every tool here returns JSON text, and
 * a verification script wants to poke at whatever came back rather than mirror
 * each tool's result type — so the shape is deliberately loose.
 */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function payload(result: { content?: unknown }): Json {
  const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
  const text = content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

async function main() {
  // an access token for a real admin of the space
  const holder = await prisma.userAlias.findFirst({
    where: { spaceId: SPACE, aliasId: OWNER_ALIAS_ID },
    select: { userId: true },
  });
  if (!holder) throw new Error(`nobody manages ${SPACE}`);
  const admin = await prisma.user.findUnique({
    where: { id: holder.userId },
    select: { id: true, name: true, email: true },
  });
  if (!admin) throw new Error(`alias holder ${holder.userId} has no user row`);

  const { token } = await mintAccessToken(
    { userId: admin.id, name: admin.name ?? '', email: admin.email ?? '' },
    MCP_SCOPES,
    'verify-fund-metrics-mcp',
    'context',
  );

  const client = new Client({ name: 'verify-fund-metrics', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(MCP_URL, {
    authProvider: { token: async () => token },
  });
  await client.connect(transport);
  console.log(`connected to ${MCP_URL} as ${admin.email}\n`);

  const call = async (name: string, args: Record<string, unknown>) =>
    payload(await client.callTool({ name, arguments: args }));

  // discovery
  const tools = await client.listTools();
  check(
    'the MCP server advertises list_connectors + run_connector',
    tools.tools.some((t) => t.name === 'list_connectors') && tools.tools.some((t) => t.name === 'run_connector'),
    tools.tools.map((t) => t.name).join(', '),
  );

  const listed = await call('list_connectors', { space_id: SPACE });
  const fundConnector = (listed.connectors ?? []).find((c: Json) => c.name === 'fund-metrics');
  check(
    'list_connectors returns the fund-metrics connector, valid, with its perimeter',
    Boolean(fundConnector) && fundConnector.invalid === null && fundConnector.hosts.length > 0,
    fundConnector
      ? `hosts: ${fundConnector.hosts.join(',')} | secrets: ${fundConnector.secrets.join(',')} | ${fundConnector.description ?? ''}`
      : `not found among: ${(listed.connectors ?? []).map((c: Json) => c.name).join(', ')}`,
  );

  check(
    'the docs an agent reads explain how to call it, without leaking a secret value',
    Boolean(fundConnector?.docs?.includes('env.FUND_KEY')) && !fundConnector?.docs?.includes('sk_fundmetrics'),
    (fundConnector?.docs ?? '').split('\n').find((l: string) => l.includes('fetch(')) ?? '(no fetch example)',
  );

  // the actual data pull
  const runConnector = (code: string) =>
    call('run_connector', { space_id: SPACE, connector: 'fund-metrics', code });
  const shown = (r: Json) => JSON.stringify(r.value ?? null);

  const funds = await runConnector(`
    const res = await fetch(\`\${env.FUND_API}/funds\`, {
      headers: { 'x-fund-key': env.FUND_KEY },
    })
    return JSON.parse(res.body)
  `);
  const fundsBody = funds.value as Json | null;
  check(
    'run_connector pulls the fund list through the isolate',
    funds.ok === true && Array.isArray(fundsBody?.funds) && fundsBody.funds.length === 3,
    `${funds.duration_ms}ms — ${
      Array.isArray(fundsBody?.funds)
        ? fundsBody.funds.map((f: Json) => `${f.name} TVPI ${f.tvpi}`).join('; ')
        : shown(funds).slice(0, 200)
    }`,
  );

  const metrics = await runConnector(`
    const res = await fetch(\`\${env.FUND_API}/funds/fund_bb3/metrics\`, {
      headers: { 'x-fund-key': env.FUND_KEY },
    })
    const { name, dpi, tvpi, net_irr_pct } = JSON.parse(res.body).metrics
    return { name, dpi, tvpi, irr: net_irr_pct }
  `);
  check(
    'shaping the answer inside the isolate returns just the metrics asked for',
    metrics.ok === true && shown(metrics).includes('"tvpi":2.48') && shown(metrics).includes('"irr":27.4'),
    shown(metrics) || metrics.error?.message,
  );

  const positions = await runConnector(`
    const res = await fetch(\`\${env.FUND_API}/funds/fund_bb3/positions\`, {
      headers: { 'x-fund-key': env.FUND_KEY },
    })
    const active = JSON.parse(res.body).positions.filter((p) => p.status === 'active')
    return { n: active.length, fair_value: active.reduce((t, p) => t + p.fair_value_usd, 0) }
  `);
  check(
    'a computed answer (active positions, summed fair value) comes back',
    positions.ok === true && shown(positions).includes('"n":3'),
    shown(positions) || positions.error?.message,
  );

  // the secret was resolved server-side, never handed to the caller
  const unauth = await runConnector(`
    const res = await fetch(\`\${env.FUND_API}/funds\`)
    return res.status
  `);
  check(
    'the same call without the key header is refused by the API (401)',
    unauth.value === 401,
    `http ${shown(unauth)} — proves the earlier 200s came from the resolved secret, not an open endpoint`,
  );

  const whoami = await runConnector(`
    const res = await fetch(\`\${env.FUND_API}/whoami\`, {
      headers: { 'x-fund-key': env.FUND_KEY },
    })
    return res.body
  `);
  check(
    'a reflected secret comes back [redacted]',
    shown(whoami).includes('[redacted]') && !shown(whoami).includes('sk_fundmetrics'),
    shown(whoami).slice(0, 160),
  );

  // the perimeter
  const offPerimeter = await runConnector(
    `try { await fetch('https://example.com/') } catch (e) { return e.message }`,
  );
  check(
    'a host outside the perimeter is refused',
    (offPerimeter.denials ?? []).length > 0 || shown(offPerimeter).includes('egress denied'),
    `denials: ${JSON.stringify(offPerimeter.denials ?? [])}`,
  );

  // the context note that hangs off the connector
  const context = await call('search_context', { space_id: SPACE, query: 'TVPI' });
  const hit = JSON.stringify(context);
  check(
    'the attached context note is discoverable and points at the connector',
    hit.includes('fund-portfolio') || hit.includes('Fund portfolio'),
    hit.slice(0, 240),
  );

  await client.close();

  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
