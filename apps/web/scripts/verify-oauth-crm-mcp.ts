/**
 * The hard end-to-end connector test, over a real MCP connection: a vendor API
 * with OAuth2 client-credentials, 5-second access tokens, rotating refresh
 * tokens, a 6-per-10s rate limit and cursor pagination — all handled by shell
 * commands the note teaches, with zero platform code per behaviour.
 *
 * Needs `pnpm dev` running and `pnpm db:connectors:oauth` seeded.
 *
 *   pnpm connectors:verify:oauth [spaceId]
 */
import 'dotenv/config';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import prisma from '../lib/prisma';
import { ADMIN_ALIAS_ID } from '../lib/types/context';
import { mintAccessToken } from '../lib/mcp/tokens';
import { MCP_SCOPES } from '../lib/mcp/scopes';

const SPACE = process.argv[2] ?? 'community:blackbird-ventures';
const APP = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const MCP_URL = new URL(`${APP}/api/mcp`);

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n        ${detail.slice(0, 500)}\n`);
  if (ok) pass++;
  else fail++;
}

/** Loose by design — a verification script pokes at whatever came back. */
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

/**
 * The token helper + refreshing fetch loop the note teaches, as one preamble.
 *
 * Counters are plain closure variables now. Under the shell they had to live in
 * files, because every call site captured output with `$(fetch …)` and a
 * subshell discarded anything the function incremented.
 */
const PREAMBLE = `
let waits = 0, refreshes = 0, token = null
const login = async () => {
  const res = await fetch(\`\${env.CRM_API}/oauth/token\`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.CRM_CLIENT_ID,
      client_secret: env.CRM_CLIENT_SECRET,
    }).toString(),
  })
  token = JSON.parse(res.body).access_token
}
const get = async (path) => {
  if (!token) await login()
  for (let attempt = 0; attempt < 12; attempt++) {
    const res = await fetch(\`\${env.CRM_API}\${path}\`, {
      headers: { Authorization: \`Bearer \${token}\` },
    })
    if (res.status === 200) return JSON.parse(res.body)
    if (res.status === 401) { refreshes++; await login(); continue }
    if (res.status === 429) { waits++; await sleep((JSON.parse(res.body).retry_after ?? 3) * 1000); continue }
    throw new Error(\`unexpected \${res.status}: \${res.body.slice(0, 200)}\`)
  }
  throw new Error(\`gave up on \${path}\`)
}
`;

/**
 * The fake CRM rate-limits per client across ALL runs, so consecutive checks
 * would starve each other. Wait out the 10s window between the ones that spend
 * budget — this is a property of the fixture, not of connectors.
 */
const RATE_WINDOW_MS = 10_500;
const settle = () => new Promise((r) => setTimeout(r, RATE_WINDOW_MS));

async function main() {
  const holder = await prisma.userAlias.findFirst({
    where: { spaceId: SPACE, aliasId: ADMIN_ALIAS_ID },
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
    'verify-oauth-crm-mcp',
  );

  const client = new Client({ name: 'verify-oauth-crm', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(MCP_URL, { authProvider: { token: async () => token } }));
  console.log(`connected to ${MCP_URL} as ${admin.email}\n`);

  // One tool, and an action named inside it. `input` is what makes it RUN
  // rather than hand back the action's manual (lib/mcp/gateway.ts).
  const call = async (action: string, input: Record<string, unknown>) =>
    payload(await client.callTool({ name: 'visvine', arguments: { action, input } }));

  const runConnector = (code: string) =>
    call('run_connector', { space_id: SPACE, connector: 'crm', code });

  /** The run's returned value as compact JSON, for substring assertions. */
  const shown = (r: { value?: unknown }) => JSON.stringify(r.value ?? null);

  // 1. the token dance
  const auth = await runConnector(`
    const res = await fetch(\`\${env.CRM_API}/oauth/token\`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: env.CRM_CLIENT_ID,
        client_secret: env.CRM_CLIENT_SECRET,
      }).toString(),
    })
    const body = JSON.parse(res.body)
    return { has_access: body.access_token != null, has_refresh: body.refresh_token != null, expires_in: body.expires_in }
  `);
  check(
    'OAuth2 client-credentials exchange succeeds with secrets resolved server-side',
    auth.ok === true && shown(auth).includes('"has_access":true') && shown(auth).includes('"expires_in":5'),
    shown(auth) || auth.error?.message,
  );

  // --- 2. wrong credentials are rejected (the secret really is being checked)
  const badCreds = await runConnector(`
    const res = await fetch(\`\${env.CRM_API}/oauth/token\`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: env.CRM_CLIENT_ID,
        client_secret: 'wrong-secret',
      }).toString(),
    })
    return JSON.parse(res.body)
  `);
  check(
    'a wrong client_secret is refused — the earlier success was not a free pass',
    shown(badCreds).includes('invalid_client'),
    shown(badCreds),
  );

  // 3. expiry → refresh
  await settle();
  const refresh = await runConnector(`${PREAMBLE}
    const first = (await get('/v1/me')).scopes[0]
    await sleep(6000)                        // outlive the 5s access token
    const afterExpiry = (await get('/v1/me')).scopes[0]
    return { first, after_expiry: afterExpiry, refreshes_needed: refreshes }
  `);
  check(
    'an expired access token is detected (401) and the run re-auths and succeeds',
    refresh.ok === true &&
      shown(refresh).includes('"refreshes_needed":1') &&
      shown(refresh).includes('"after_expiry":"contacts:read"'),
    shown(refresh) || refresh.error?.message,
  );

  // 4. rate limit: 429 + retry_after, honoured
  await settle();
  const limited = await runConnector(`
    const res = await fetch(\`\${env.CRM_API}/oauth/token\`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: env.CRM_CLIENT_ID,
        client_secret: env.CRM_CLIENT_SECRET,
      }).toString(),
    })
    const token = JSON.parse(res.body).access_token
    const codes = []
    let retryAfter = null
    for (let i = 0; i < 9; i++) {
      const r = await fetch(\`\${env.CRM_API}/v1/me\`, { headers: { Authorization: \`Bearer \${token}\` } })
      codes.push(r.status)
      if (r.status === 429) retryAfter = r.headers['retry-after'] ?? JSON.parse(r.body).retry_after
    }
    return { codes, retry_after: retryAfter }
  `);
  check(
    'the rate limiter trips at 6 requests and answers 429 with a retry hint',
    shown(limited).includes('429') && /"retry_after":"?\d+/.test(shown(limited)),
    shown(limited),
  );

  await settle();
  const backoff = await runConnector(`${PREAMBLE}
    for (let i = 0; i < 8; i++) await get('/v1/me')
    return { rate_limit_waits: waits, token_refreshes: refreshes, finished: true }
  `);
  check(
    'a backoff loop rides out the rate limit and still completes every call',
    backoff.ok === true && shown(backoff).includes('"finished":true'),
    `${shown(backoff)} (in ${backoff.duration_ms}ms)`,
  );

  // 5. pagination
  await settle();
  const paginated = await runConnector(`${PREAMBLE}
    const all = []
    let cursor = null, pages = 0
    do {
      const page = await get(\`/v1/contacts\${cursor ? \`?cursor=\${cursor}\` : ''}\`)
      pages++
      all.push(...page.contacts)
      cursor = page.next_cursor
    } while (cursor)
    return {
      contacts: all.length,
      pages,
      rate_limit_waits: waits,
      token_refreshes: refreshes,
      customer_arr: all.filter((c) => c.stage === 'customer').reduce((n, c) => n + c.arr_usd, 0),
    }
  `);
  check(
    'cursor pagination walks every page and aggregates the answer',
    paginated.ok === true &&
      shown(paginated).includes('"contacts":7') &&
      shown(paginated).includes('"pages":4') &&
      shown(paginated).includes('"customer_arr":1145000'),
    `${shown(paginated)} (in ${paginated.duration_ms}ms)`,
  );

  // 6. secrets never come back
  const leak = await runConnector(
    'return `id=${env.CRM_CLIENT_ID} secret=${env.CRM_CLIENT_SECRET}`',
  );
  check(
    'code that deliberately returns its secrets gets them redacted',
    !shown(leak).includes('sk_crm_secret') &&
      !shown(leak).includes('crm_client_local_dev') &&
      shown(leak).includes('[redacted]'),
    shown(leak),
  );

  // 7. the perimeter still holds under all this
  const offPath = await runConnector(
    `try { await fetch(\`\${env.CRM_API}/v1/contacts\`, { method: 'POST', body: 'x=1' }) } catch (e) { return e.message }`,
  );
  check(
    'a method+path outside the allow rules is refused even on an allowed host',
    (offPath.denials ?? []).length > 0 || shown(offPath).includes('egress denied'),
    `${JSON.stringify(offPath.denials ?? [])} ${shown(offPath).slice(0, 160)}`,
  );

  const offHost = await runConnector(
    `try { await fetch('https://api.stripe.com/v1/customers') } catch (e) { return e.message }`,
  );
  check(
    'an unlisted host is refused',
    (offHost.denials ?? []).length > 0 || shown(offHost).includes('egress denied'),
    `denials: ${JSON.stringify(offHost.denials ?? [])}`,
  );

  await client.close();

  console.log(`${pass}/${pass + fail} checks passed`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
