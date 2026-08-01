/**
 * Live end-to-end check for the seeded demo connectors — the counterpart to the
 * pure unit tests in tests/connectors.test.ts, which can't cover real sockets.
 * Drives the actual service + executor layer (visibility lens → config parse →
 * secret decrypt → execute → redaction), which is everything `call_connector`
 * and `query_connector` do minus the MCP transport.
 *
 * Needs `pnpm dev` running and `pnpm db:connectors:demo` already seeded.
 *
 *   pnpm --filter @visvine/web exec tsx scripts/verify-connectors-demo.ts
 */
import 'dotenv/config';
import prisma from '../lib/prisma';
import { resolveBrain, principalOf } from '../lib/notes/brain';
import { listConnectors, loadConnector, resolveSecretValues } from '../lib/connectors/service';
import { findSecretRefs, ConnectorError } from '../lib/connectors/config';
import { executeHttpConnector } from '../lib/connectors/http';
import { executePostgresQuery } from '../lib/connectors/postgres';

const COMMUNITY = process.argv[2] ?? 'community:local-dev';

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n        ${detail}`);
  if (ok) pass++;
  else fail++;
}

async function main() {
  const admin = await prisma.userCommunity.findFirst({
    where: { communityId: COMMUNITY, role: 'admin' },
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  if (!admin) throw new Error(`no admin in ${COMMUNITY}`);
  const session = { userId: admin.user.id, name: admin.user.name ?? '', email: admin.user.email ?? '' };

  const resolved = await resolveBrain(session, COMMUNITY);
  if (resolved instanceof Response) throw new Error(`resolveBrain: ${resolved.status}`);
  const principal = await principalOf(resolved);
  const brain = resolved; // ResolvedBrain extends Brain

  // --- discovery -------------------------------------------------------------
  const connectors = await listConnectors(principal, brain);
  check(
    'list_connectors sees both seeded connectors',
    connectors.some((c) => c.name === 'sandbox') && connectors.some((c) => c.name === 'appdb'),
    connectors.map((c) => `${c.name}(${c.alias})${c.invalid ? ' INVALID: ' + c.invalid : ''}`).join(', '),
  );
  const sandboxSummary = connectors.find((c) => c.name === 'sandbox');
  check(
    'sandbox parses and its allowlist excludes DELETE',
    !!sandboxSummary && sandboxSummary.invalid === null && !sandboxSummary.allow.some((a) => a.startsWith('DELETE')),
    `allow = [${sandboxSummary?.allow.join(', ')}]`,
  );
  check(
    'list_connectors reports secret NAMES only',
    JSON.stringify(connectors.flatMap((c) => c.secrets).sort()) === JSON.stringify(['APPDB_DSN', 'SANDBOX_KEY']),
    connectors.map((c) => `${c.name}: ${c.secrets.join()}`).join(' | '),
  );

  // --- http connector --------------------------------------------------------
  const sandbox = await loadConnector(principal, brain, 'sandbox');
  if (!sandbox || sandbox.config.alias !== 'http') throw new Error('sandbox connector did not load as http');
  const httpConfig = sandbox.config;
  const httpSecrets = await resolveSecretValues(
    COMMUNITY,
    [...new Set(Object.values(httpConfig.headers).flatMap(findSecretRefs))],
  );
  const key = httpSecrets.get('SANDBOX_KEY') ?? '';

  const call = (c: Parameters<typeof executeHttpConnector>[2]) =>
    executeHttpConnector(httpConfig, httpSecrets, c);

  const list = await call({ method: 'GET', path: '/widgets', query: { q: 'rubber' } });
  check(
    'GET /widgets?q=rubber authenticates and filters',
    list.status === 200 && JSON.parse(list.body).total === 3,
    `status ${list.status}, body ${list.body.slice(0, 120)}`,
  );

  const one = await call({ method: 'GET', path: '/widgets/wid_002' });
  check(
    'GET /widgets/* matches the single-segment wildcard',
    one.status === 200 && JSON.parse(one.body).widget?.name === 'Flange',
    `status ${one.status}, body ${one.body.slice(0, 100)}`,
  );

  const created = await call({ method: 'POST', path: '/widgets', body: JSON.stringify({ name: 'Cam' }) });
  check(
    'POST /widgets carries the request body upstream',
    created.status === 201 && JSON.parse(created.body).echo?.name === 'Cam',
    `status ${created.status}, body ${created.body.slice(0, 120)}`,
  );

  const who = await call({ method: 'GET', path: '/whoami' });
  check(
    'the API key is redacted out of a response that echoes it',
    who.status === 200 && !who.body.includes(key) && who.body.includes('[redacted]'),
    `x-sandbox-key came back as ${JSON.parse(who.body).seen_headers?.['x-sandbox-key']}`,
  );

  const denied = await call({ method: 'DELETE', path: '/widgets/wid_001' }).catch((e) => e);
  check(
    'DELETE is refused by the allowlist before any request is sent',
    denied instanceof ConnectorError && denied.code === 'denied',
    `${denied?.code ?? 'no error'}: ${denied?.message?.slice(0, 140)}`,
  );

  const traversal = await call({ method: 'GET', path: '/widgets/../../secret' }).catch((e) => e);
  check(
    'a traversal path is rejected outright',
    traversal instanceof ConnectorError && traversal.code === 'denied',
    `${traversal?.code ?? 'no error'}: ${traversal?.message?.slice(0, 100)}`,
  );

  const slow = await call({ method: 'GET', path: '/slow', query: { ms: '8000' } }).catch((e) => e);
  check(
    `GET /slow aborts at timeout_ms=${httpConfig.timeoutMs}`,
    slow instanceof ConnectorError && slow.code === 'timeout',
    `${slow?.code ?? 'no error'}: ${slow?.message?.slice(0, 100)}`,
  );

  const big = await call({ method: 'GET', path: '/big', query: { kb: '400' } });
  check(
    'an oversized body is capped at 256 KB and flagged truncated',
    big.truncated && big.body.length <= 256 * 1024 + 4096,
    `truncated=${big.truncated}, ${big.body.length} chars of a 409600-byte payload`,
  );

  const redirect = await call({ method: 'GET', path: '/redirect' }).catch((e) => e);
  check(
    'a 302 is refused rather than followed',
    redirect instanceof ConnectorError && redirect.code === 'upstream',
    `${redirect?.code ?? 'no error'}: ${redirect?.message?.slice(0, 100)}`,
  );

  // --- postgres connector ----------------------------------------------------
  const appdb = await loadConnector(principal, brain, 'appdb');
  if (!appdb || appdb.config.alias !== 'postgres') throw new Error('appdb connector did not load as postgres');
  const pgConfig = appdb.config;
  const dsn = (await resolveSecretValues(COMMUNITY, findSecretRefs(pgConfig.dsn))).get(
    findSecretRefs(pgConfig.dsn)[0],
  )!;

  const counts = await executePostgresQuery(
    pgConfig,
    dsn,
    `SELECT type, count(*) AS n FROM nodes WHERE community_id = '${COMMUNITY}' GROUP BY type ORDER BY n DESC`,
  );
  check(
    'query_connector runs a SELECT against the dev database',
    counts.row_count > 0 && counts.columns.join() === 'type,n',
    `${counts.row_count} rows: ${JSON.stringify(counts.rows.slice(0, 4))}`,
  );

  const write = await executePostgresQuery(pgConfig, dsn, "DELETE FROM nodes WHERE id = 'nope'").catch((e) => e);
  check(
    'a write statement is refused',
    write instanceof ConnectorError && write.code === 'denied',
    `${write?.code ?? 'no error'}: ${write?.message?.slice(0, 100)}`,
  );

  const multi = await executePostgresQuery(pgConfig, dsn, 'SELECT 1; DROP TABLE nodes').catch((e) => e);
  check(
    'a second statement is refused',
    multi instanceof ConnectorError && multi.code === 'denied',
    `${multi?.code ?? 'no error'}: ${multi?.message?.slice(0, 100)}`,
  );

  const writingCte = await executePostgresQuery(
    pgConfig,
    dsn,
    "WITH d AS (DELETE FROM nodes WHERE id = 'nope' RETURNING 1) SELECT * FROM d",
  ).catch((e) => e);
  check(
    'a writing CTE (SELECT-shaped) is stopped by the read-only transaction',
    writingCte instanceof ConnectorError && (writingCte.code === 'denied' || writingCte.code === 'upstream'),
    `${writingCte?.code ?? 'no error'}: ${writingCte?.message?.slice(0, 120)}`,
  );

  const capped = await executePostgresQuery(pgConfig, dsn, 'SELECT id FROM nodes');
  check(
    `rows are capped at max_rows=${pgConfig.maxRows}`,
    capped.row_count <= pgConfig.maxRows,
    `${capped.row_count} rows, truncated=${capped.truncated}`,
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
