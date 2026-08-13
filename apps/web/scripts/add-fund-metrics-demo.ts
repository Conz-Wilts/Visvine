/**
 * Seeds an end-to-end connector test case with data a fund space actually
 * cares about: fund metrics.
 *
 * Three things land in the space's SHARED context:
 *   • connectors/fund-metrics.md — a v2 connector (hosts + env perimeter, prose
 *     body) pointed at /api/dev/fund-metrics, this app's fake fund-admin API.
 *   • funds/fund-portfolio.md — an ordinary CONTEXT note about the funds, which
 *     links to the connector note, so the connector is reachable from the graph
 *     the way a real analyst would find it.
 *   • the FUND_METRICS_KEY secret, encrypted under SECRETS_KEY exactly as the
 *     admin console writes it.
 *
 * Then `pnpm connectors:verify:funds` drives a real MCP client against it.
 *
 * Usage:
 *   pnpm db:connectors:funds                      # community:blackbird-ventures
 *   pnpm db:connectors:funds <spaceId>
 *   pnpm db:connectors:funds <spaceId> --remove
 *
 * Local-only, guarded like the other db:* seeds — it writes plaintext-derived
 * secrets and points a connector at a private host.
 */

import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import prisma from '../lib/prisma';
import { OWNER_ALIAS_NAME } from '../lib/types/context';
import { encryptSecret } from '../lib/crypto/secrets';
import { syncContextLinksBulk } from '../lib/notes/entityLinks';

/** Kept in step with the same expression in the fund-metrics route by hand. */
const FUND_KEY = process.env.CONNECTOR_FUND_METRICS_KEY || 'sk_fundmetrics_local_dev';

const spaceId = process.argv[2]?.startsWith('--')
  ? 'community:blackbird-ventures'
  : (process.argv[2] ?? 'community:blackbird-ventures');
const REMOVE = process.argv.includes('--remove');
const SHARED = 'shared';

const appOrigin = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const apiHost = new URL(appOrigin).host; // e.g. localhost:3000 — what `hosts:` gates on
const apiBase = `${appOrigin}/api/dev/fund-metrics`;

// the connector note (perimeter + prose)

const CONNECTOR_NOTE = `---
type: connector
alias: http
title: Fund Metrics API
description: Fund administrator API — committed/called capital, DPI, TVPI, net IRR, positions and quarterly NAV series
hosts:
  - ${apiHost}
allow:
  # Prefix rule — the \`*\` must be glued to the path. \`/fund-metrics/*\` would be
  # a single-segment wildcard and would refuse \`/funds/{id}/metrics\`.
  - "GET /api/dev/fund-metrics*"
env:
  FUND_KEY: "{{secret:FUND_METRICS_KEY}}"
  FUND_API: "${apiBase}"
timeout_ms: 15000
---

The fund administrator's reporting API. It is the system of record for
fund-level performance: committed and called capital, distributions, NAV, DPI,
TVPI and net IRR, plus the positions and quarterly series behind those numbers.

In local development this is served by this same app at \`/api/dev/fund-metrics\`
and only responds when \`ENABLE_DEV_AUTH=true\`.

Every request needs an API key in the \`x-fund-key\` header. You never supply the
value: it is already in the isolate as \`env.FUND_KEY\`, resolved server-side from
the \`FUND_METRICS_KEY\` secret. A \`401 unauthorized\` means that secret is missing
or wrong, not that the call was malformed. The base URL is in \`env.FUND_API\`.

## Calling this connector

    const res = await fetch(\`\${env.FUND_API}/funds\`, {
      headers: { 'x-fund-key': env.FUND_KEY },
    })
    return JSON.parse(res.body)

\`fetch\` hands back \`{ status, ok, headers, body, truncated }\` and \`body\` is a
string, so parse it yourself. Shape the answer before returning it rather than
handing back everything:

    const res = await fetch(\`\${env.FUND_API}/funds\`, {
      headers: { 'x-fund-key': env.FUND_KEY },
    })
    return JSON.parse(res.body).funds.map(
      ({ name, tvpi, dpi, net_irr_pct }) => ({ name, tvpi, dpi, net_irr_pct }),
    )

Other useful calls, same shape: \`/funds/fund_bb3/metrics\`,
\`/funds/fund_bb3/positions\`, \`/funds/fund_bb3/series\`.

## Endpoints

| Call | What it returns |
| --- | --- |
| \`GET /funds\` | Every fund with headline metrics. \`?vintage=2019\` filters. |
| \`GET /funds/{id}/metrics\` | One fund's headline metrics. |
| \`GET /funds/{id}/positions\` | The holdings behind those metrics. |
| \`GET /funds/{id}/series\` | Quarterly NAV and TVPI history. |
| \`GET /whoami\` | Reflects request headers — the redaction probe. |

Fund ids are \`fund_bb3\`, \`fund_bb4\`, \`fund_bbg1\`.

## Reading the numbers

- All \`*_usd\` fields are whole US dollars, not cents.
- \`dpi\` = distributed / called. \`tvpi\` = (distributed + NAV) / called.
- \`net_irr_pct\` is already a percentage — \`27.4\` means 27.4%.
- Figures are as of the \`as_of\` date and are unaudited between year ends.

## Guard rails

- The isolate may only reach \`${apiHost}\`; any other host is refused before the
  request leaves.
- \`GET /whoami\` reflects the API key back at you and the response should read
  \`[redacted]\` — resolved secret values are scrubbed from everything returned.
`;

// the context note that hangs off it

const CONTEXT_NOTE = `---
type: note
title: Fund portfolio
description: The three active funds, what drives their numbers, and where the numbers come from
---

# Fund portfolio

Three active vehicles. Live figures are never typed into this note — pull them
from the [Fund Metrics API](/connectors/fund-metrics.md) connector, which is the
system of record.

| Fund | Vintage | Strategy | Commitment |
| --- | --- | --- | --- |
| Blackbird Fund III (\`fund_bb3\`) | 2019 | Early-stage venture | $250M |
| Blackbird Fund IV (\`fund_bb4\`) | 2022 | Early-stage venture | $400M |
| Blackbird Growth I (\`fund_bbg1\`) | 2023 | Growth | $300M |

## What to know before quoting a number

- **Fund III is the mature book.** It carries the marks that move the firm's
  headline TVPI; Canva alone is the majority of its fair value.
- **Fund IV and Growth I are early.** DPI is 0.00 by construction — nothing has
  been distributed yet, so judge them on TVPI and pacing, not DPI.
- **Net IRR is time-weighted against called capital**, so a fund that has called
  slowly can show a high IRR on a small base. Always quote it beside TVPI.
- Marks are unaudited between year ends. For anything going to an LP, state the
  \`as_of\` date the API returns.

## How to answer a question about performance

Run the connector rather than trusting anything written here:

    run_connector(connector: 'fund-metrics', code: ...) where the code is:

    const res = await fetch(env.FUND_API + '/funds', {
      headers: { 'x-fund-key': env.FUND_KEY },
    })
    return JSON.parse(res.body).funds.map(
      ({ name, tvpi, net_irr_pct }) => ({ name, tvpi, net_irr_pct }),
    )
`;

const NOTES = [
  { path: 'connectors/fund-metrics.md', content: CONNECTOR_NOTE },
  { path: 'funds/fund-portfolio.md', content: CONTEXT_NOTE },
];

const SECRETS = [{ name: 'FUND_METRICS_KEY', value: FUND_KEY }];

// write

async function main() {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { id: true, name: true },
  });
  if (!space) {
    throw new Error(`space ${spaceId} not found — run \`pnpm db:seed\` first`);
  }

  if (REMOVE) {
    const notes = await prisma.contextNote.deleteMany({
      where: { spaceId, ownerKey: SHARED, path: { in: NOTES.map((n) => n.path) } },
    });
    const secrets = await prisma.connectorSecret.deleteMany({
      where: { spaceId, name: { in: SECRETS.map((s) => s.name) } },
    });
    await syncContextLinksBulk({ spaceId, ownerKey: SHARED }, NOTES.map((n) => n.path));
    console.log(`Removed ${notes.count} note(s) and ${secrets.count} secret(s) from ${space.name}`);
    return;
  }

  const owner =
    (await prisma.userAlias.findFirst({
      where: { spaceId, aliasName: OWNER_ALIAS_NAME },
      select: { userId: true },
    })) ?? (await prisma.spaceMember.findFirst({ where: { spaceId }, select: { userId: true } }));
  if (!owner) throw new Error(`space ${spaceId} has no members to attribute the notes to`);

  for (const note of NOTES) {
    await prisma.contextNote.upsert({
      where: { note_identity: { spaceId, ownerKey: SHARED, path: note.path } },
      create: { spaceId, ownerKey: SHARED, path: note.path, content: note.content, createdBy: owner.userId },
      update: { content: note.content, deletedAt: null, deletedPath: null },
    });
  }

  // Direct table writes bypass the note store, so the connector node and the
  // context links between these notes are ours to keep in step.
  await syncContextLinksBulk(
    { spaceId, ownerKey: SHARED },
    [],
    NOTES.map((n) => [n.path, n.content] as [string, string]),
  );

  for (const secret of SECRETS) {
    await prisma.connectorSecret.upsert({
      where: { secret_identity: { spaceId, name: secret.name } },
      create: {
        spaceId,
        name: secret.name,
        ciphertext: encryptSecret(secret.value),
        createdBy: 'add-fund-metrics-demo',
      },
      update: { ciphertext: encryptSecret(secret.value), createdBy: 'add-fund-metrics-demo' },
    });
  }

  console.log(`=== Seeded fund-metrics test case into ${space.name} (${spaceId}) ===`);
  for (const note of NOTES) console.log(`  note   shared:${note.path}`);
  for (const secret of SECRETS) console.log(`  secret ${secret.name}`);
  console.log(`\n  API: ${apiBase}  (host gate: ${apiHost})`);
  console.log('  Needs ENABLE_DEV_AUTH=true and CONNECTORS_ALLOW_PRIVATE_HOSTS=true in apps/web/.env');
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
