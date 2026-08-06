/**
 * Live end-to-end check for the seeded demo connectors — the counterpart to the
 * pure unit tests in tests/connectors.test.ts and the runtime tests in
 * tests/connector-sandbox.test.ts, which can't cover the full stack. Drives the
 * actual service layer (visibility lens → perimeter parse → secret decrypt →
 * sandbox run → redaction), which is everything `run_connector` does minus the
 * MCP transport.
 *
 * Needs `pnpm dev` running, `pnpm db:connectors:demo` seeded and the notes
 * migrated to v2 (`pnpm db:connectors:migrate --write`). The psql client must
 * be on PATH for the appdb check.
 *
 *   pnpm --filter @visvine/web exec tsx scripts/verify-connectors-demo.ts
 */
import 'dotenv/config';
import prisma from '../lib/prisma';
import { OWNER_ALIAS_NAME } from '../lib/types/context';
import { resolveBrain, principalOf } from '../lib/notes/brain';
import { executeConnectorScript, listConnectors, loadConnector } from '../lib/connectors/service';

const COMMUNITY = process.argv[2] ?? 'community:blackbird-ventures';

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n        ${detail}`);
  if (ok) pass++;
  else fail++;
}

async function main() {
  const holder = await prisma.userAlias.findFirst({
    where: { communityId: COMMUNITY, aliasName: OWNER_ALIAS_NAME },
    select: { userId: true },
  });
  if (!holder) throw new Error(`nobody manages ${COMMUNITY}`);
  const admin = await prisma.user.findUnique({
    where: { id: holder.userId },
    select: { id: true, name: true, email: true },
  });
  if (!admin) throw new Error(`alias holder ${holder.userId} has no user row`);
  const session = { userId: admin.id, name: admin.name ?? '', email: admin.email ?? '' };

  const resolved = await resolveBrain(session, COMMUNITY);
  if (resolved instanceof Response) throw new Error(`resolveBrain: ${resolved.status}`);
  const principal = await principalOf(resolved);
  const brain = resolved; // ResolvedBrain extends Brain

  // --- discovery -------------------------------------------------------------
  const connectors = await listConnectors(principal, brain);
  check(
    'list_connectors sees both seeded connectors, parsed as v2',
    connectors.some((c) => c.name === 'sandbox' && c.invalid === null && c.hosts.length > 0) &&
      connectors.some((c) => c.name === 'appdb' && c.invalid === null && c.hosts.length > 0),
    connectors
      .map((c) => `${c.name}(hosts: ${c.hosts.join(',') || 'none'})${c.invalid ? ' INVALID: ' + c.invalid : ''}`)
      .join(', '),
  );

  const sandbox = await loadConnector(principal, brain, 'sandbox');
  if (!sandbox) throw new Error('sandbox connector did not load');
  const run = (code: string) => executeConnectorScript(principal, brain, COMMUNITY, sandbox, code);
  const shown = (r: { value?: unknown }) => JSON.stringify(r.value ?? null);

  // --- a real call, secret resolved server-side ------------------------------
  const widgets = await run(`
    const res = await fetch(\`\${env.SANDBOX_API}/widgets\`, {
      headers: { 'x-sandbox-key': env.SANDBOX_KEY },
    })
    return JSON.parse(res.body).widgets.map((w) => w.name)
  `);
  check(
    'fetch through the isolate reaches the fake API with the secret resolved',
    widgets.ok && shown(widgets).includes('Sprocket'),
    `${shown(widgets).slice(0, 80)}… ${widgets.error?.message ?? ''}`,
  );

  // --- redaction: the reflected key must not survive -------------------------
  const whoami = await run(`
    const res = await fetch(\`\${env.SANDBOX_API}/whoami\`, {
      headers: { 'x-sandbox-key': env.SANDBOX_KEY },
    })
    return res.body
  `);
  check(
    'a reflected secret comes back [redacted]',
    shown(whoami).includes('[redacted]') && !shown(whoami).includes('sk_sandbox'),
    shown(whoami).slice(0, 120),
  );

  // --- the perimeter: an unlisted host is refused ----------------------------
  const outside = await run(
    `try { await fetch('http://example.com/') } catch (e) { return e.message }`,
  );
  check(
    'egress to an unlisted host is denied before the request leaves',
    outside.denials.length > 0 && shown(outside).includes('egress denied'),
    outside.denials[0] ?? shown(outside).slice(0, 80),
  );

  // --- allow rules: DELETE is real upstream but not permitted ----------------
  const del = await run(`
    try {
      await fetch(\`\${env.SANDBOX_API}/widgets/wid_001\`, {
        method: 'DELETE',
        headers: { 'x-sandbox-key': env.SANDBOX_KEY },
      })
    } catch (e) { return e.message }
  `);
  check(
    'DELETE is refused by the allow rules before any request leaves',
    del.denials.length > 0 && shown(del).includes('allow rules'),
    `denial: ${del.denials.at(-1) ?? 'none'}`,
  );

  // --- appdb: sql() through the isolate, read-only ---------------------------
  const appdb = await loadConnector(principal, brain, 'appdb');
  if (!appdb) throw new Error('appdb connector did not load');
  const query = await executeConnectorScript(
    principal,
    brain,
    COMMUNITY,
    appdb,
    `return await sql(env.APPDB_DSN, 'SELECT count(*) FROM communities')`,
  );
  check(
    'sql() queries the app database through the isolate',
    query.ok && /\d/.test(shown(query)),
    `${shown(query).slice(0, 80)} ${query.error?.message ?? ''}`,
  );
  const write = await executeConnectorScript(
    principal,
    brain,
    COMMUNITY,
    appdb,
    `try { await sql(env.APPDB_DSN, 'CREATE TABLE should_not_exist (id int)') } catch (e) { return e.message }`,
  );
  check(
    'writes are refused (read-only)',
    /read/i.test(shown(write)),
    shown(write).slice(0, 100),
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
