/**
 * Seeds a space's SHARED context with working connectors, so the MCP tools
 * `list_connectors` / `run_connector` have something real
 * to talk to in local dev.
 *
 * Two connectors, one per alias:
 *   • connectors/sandbox.md  (http)     → /api/dev/connector-sandbox, the fake
 *     external API in this same app. Needs the SANDBOX_KEY secret.
 *   • connectors/appdb.md    (postgres) → the local dev Postgres itself, via
 *     the APPDB_DSN secret. Read-only is enforced by the sql() capability.
 *
 * Both secrets are written to connector_secrets encrypted under SECRETS_KEY,
 * the same way the admin console writes them.
 *
 * Usage:
 *   pnpm db:connectors:demo                      # community:blackbird-ventures
 *   pnpm db:connectors:demo <spaceId>
 *   pnpm db:connectors:demo <spaceId> --remove
 *
 * Local-only — guarded exactly like the destructive db:* scripts. The postgres
 * connector points at your dev database and the executor has no table
 * allowlist, so an agent holding `connectors:use` can SELECT anything in it.
 * That is fine for seeded local data and is why this script refuses to run
 * against anything but a local database.
 */

import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import prisma from '../lib/prisma';
import { OWNER_ALIAS_ID } from '../lib/types/context';
import { encryptSecret } from '../lib/crypto/secrets';
import { syncContextLinksBulk } from '../lib/notes/entityLinks';

/** Kept in step with the same expression in the sandbox route by hand — the
 *  route is a Next entry point and isn't worth importing into a CLI script. */
const SANDBOX_KEY = process.env.CONNECTOR_SANDBOX_KEY || 'sk_sandbox_local_dev';

const spaceId = process.argv[2]?.startsWith('--')
  ? 'community:blackbird-ventures'
  : (process.argv[2] ?? 'community:blackbird-ventures');
const REMOVE = process.argv.includes('--remove');
const SHARED = 'shared';

const appOrigin = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const sandboxBaseUrl = `${appOrigin}/api/dev/connector-sandbox`;
/** What `hosts:` gates on — host[:port], never a URL. */
const sandboxHost = new URL(appOrigin).host;

/** The DSN the app itself uses — the connector connects as a foreign database. */
function resolveDsn(): string {
  const direct = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  if (direct) return direct;
  if (process.env.DB_HOST) {
    const pw = encodeURIComponent(process.env.DB_PASSWORD ?? '');
    return `postgresql://${process.env.DB_USER}:${pw}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME}`;
  }
  return 'postgresql://postgres:postgres@127.0.0.1:5432/app';
}

/** The DSN's own host, which is what the perimeter must list for `sql()`. */
const appdbHost = (() => {
  const url = new URL(resolveDsn());
  return url.port ? `${url.hostname}:${url.port}` : url.hostname;
})();

// the connector notes

const SANDBOX_NOTE = `---
type: connector
alias: http
title: Widgets Sandbox
description: Widgets sandbox — a fake external API served by this app, for testing connectors
hosts:
  - ${sandboxHost}
allow:
  - "GET /api/dev/connector-sandbox/widgets*"
  - "POST /api/dev/connector-sandbox/widgets"
  - "GET /api/dev/connector-sandbox/whoami"
  - "GET /api/dev/connector-sandbox/slow"
  - "GET /api/dev/connector-sandbox/big"
  - "GET /api/dev/connector-sandbox/redirect"
env:
  SANDBOX_KEY: "{{secret:SANDBOX_KEY}}"
  SANDBOX_API: "${sandboxBaseUrl}"
timeout_ms: 3000
---

A pretend third-party "widgets" service. It exists only so the connectors
feature can be exercised end to end without calling anyone's real API — it is
served by this same app at \`/api/dev/connector-sandbox\` and only responds when
\`ENABLE_DEV_AUTH=true\` in development.

Every request must carry an API key in the \`X-Sandbox-Key\` header. You never
supply it: the connector fills it in server-side from the \`SANDBOX_KEY\` secret.
A \`401 unauthorized\` back from this service means that secret is missing or
wrong, not that your call was malformed.

## Endpoints

| Call | What it returns |
| --- | --- |
| \`GET /widgets\` | All widgets. \`q\` filters on name or tag, \`limit\` caps the count. |
| \`GET /widgets/{id}\` | One widget, e.g. \`/widgets/wid_002\`. 404 when the id is unknown. |
| \`POST /widgets\` | Echoes the JSON body back as a created widget. Nothing is stored. |
| \`GET /whoami\` | Reflects the headers and query it received. |

A widget looks like
\`{ "id": "wid_001", "name": "Sprocket", "status": "active", "price_cents": 4900, "tags": ["metal"] }\`.
\`status\` is one of \`active\`, \`archived\`, \`draft\`; \`price_cents\` is an integer in cents.

### Example

\`\`\`js
const res = await fetch(\`\${env.SANDBOX_API}/widgets?q=rubber\`, {
  headers: { 'x-sandbox-key': env.SANDBOX_KEY },
})
return JSON.parse(res.body).widgets
\`\`\`

Every request needs the \`x-sandbox-key\` header; the value is in
\`env.SANDBOX_KEY\` and the base URL in \`env.SANDBOX_API\`.

## Deliberately unhappy paths

These exist to demonstrate the guard rails, and are the interesting part of this
connector:

- \`DELETE /widgets/{id}\` is a **real** route on the service but is **not** in the
  allow rules above, so \`fetch\` refuses it before any request goes out.
- \`GET /whoami\` reflects the API key back at you. The response you see should
  read \`[redacted]\` — output redaction scrubs resolved secret values out of
  everything a connector returns.
- \`GET /slow?ms=5000\` outlasts this connector's \`timeout_ms: 3000\`, so the call
  aborts rather than hanging.
- \`GET /big?kb=512\` returns more than the 256 KB response cap, so the body comes
  back cut short with \`truncated: true\`.
- \`GET /redirect\` answers 302. Redirects are never followed — the 3xx comes
  back with \`location\` set, and re-issuing it goes through the perimeter again.
`;

const APPDB_NOTE = `---
type: connector
alias: postgres
title: App Database
description: The local dev Postgres behind this app, read-only
hosts:
  - ${appdbHost}
env:
  APPDB_DSN: "{{secret:APPDB_DSN}}"
timeout_ms: 5000
---

The application's own database, exposed read-only, reached with \`sql()\`.
**Local development only** — a real deployment would point this at an analytics
replica, never at the primary.

Queries run inside \`BEGIN TRANSACTION READ ONLY\` with a statement timeout, and
only a single SELECT-shaped statement is accepted, so writes fail no matter how
they are phrased. At most 50 rows come back; add your own \`LIMIT\` and be
explicit about columns rather than relying on the cap.

## Useful tables

| Table | Notable columns |
| --- | --- |
| \`spaces\` | \`id\`, \`name\`, \`slug\`, \`personal_owner_id\` |
| \`users\` | \`id\`, \`name\`, \`email\` |
| \`space_members\` | \`user_id\`, \`space_id\`, \`status\` (\`active\` / \`pending\`) |
| \`user_aliases\` | who holds what; \`owner\` = its holders manage the space |
| \`nodes\` | \`id\`, \`space_id\`, \`type\` (\`person\`/\`group\`/\`resource\`/\`event\`…), \`name\`, \`slug\` |
| \`links\` | \`source_id\`, \`target_id\`, \`relationship\`, \`origin\` (\`context\`/\`manual\`/\`structure\`…) |
| \`context_notes\` | \`space_id\`, \`owner_key\` (\`shared\` or a user id), \`path\`, \`deleted_at\` |

### Example

\`\`\`js
return await sql(
  env.APPDB_DSN,
  \`SELECT type, count(*) AS n FROM nodes
   WHERE space_id = '${spaceId}' GROUP BY type ORDER BY n DESC\`,
)
\`\`\`

\`sql()\` gives back \`{ columns, rows, row_count, truncated }\`.

## What not to read

\`connector_secrets\` holds connector secret ciphertext and \`users.password_hash\`
holds password hashes. Neither is useful to you and both are off limits — the
read-only transaction does not make them any less sensitive.
`;

// Every folder carries an index note — the index IS the folder (see
// lib/notes/shared/indexNote.ts), so the layer that creates `connectors/` is the
// layer that names it.
const CONNECTORS_INDEX_NOTE = `---
type: Index
title: Connectors
tags: []
---

# Connectors

A connector is this space's gateway to an external API or database. The note
IS the config: its frontmatter picks the executor (\`alias\`), the hosts it may
reach and the secrets it may resolve, and the body is what the agent reads to
know how to call it.

- [App Database](/connectors/appdb.md) — the local dev Postgres, read-only
- [Sandbox API](/connectors/sandbox.md) — a fixture service for the perimeter rules
`;

const NOTES = [
  { path: 'connectors/index.md', content: CONNECTORS_INDEX_NOTE },
  { path: 'connectors/sandbox.md', content: SANDBOX_NOTE },
  { path: 'connectors/appdb.md', content: APPDB_NOTE },
];

const SECRETS = [
  { name: 'SANDBOX_KEY', value: SANDBOX_KEY },
  { name: 'APPDB_DSN', value: resolveDsn() },
];

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
    // Writing notes straight to the table bypasses the note store, so the
    // `connector:<name>` nodes it would have kept in step are ours to drop.
    await syncContextLinksBulk({ spaceId, ownerKey: SHARED }, NOTES.map((n) => n.path));
    console.log(`Removed ${notes.count} connector note(s) and ${secrets.count} secret(s) from ${space.name}`);
    return;
  }

  // Someone who manages the space owns the seeded notes; else any member.
  const owner =
    (await prisma.userAlias.findFirst({
      where: { spaceId, aliasId: OWNER_ALIAS_ID },
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

  // The note store does this on every save; a direct table write has to do it by
  // hand, or the connectors have no `connector:<name>` nodes and so no page in
  // the directory, no backlinks and no place on the context map. Bulk, because
  // the per-note call reloads the space's whole node map each time.
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
        createdBy: 'add-connector-demo',
      },
      update: { ciphertext: encryptSecret(secret.value), createdBy: 'add-connector-demo' },
    });
  }

  console.log(`=== Seeded connectors into ${space.name} (${spaceId}) ===`);
  for (const note of NOTES) console.log(`  note   shared:${note.path}`);
  for (const secret of SECRETS) console.log(`  secret ${secret.name}`);
  console.log(`\n  sandbox base_url: ${sandboxBaseUrl}`);
  console.log('  Needs ENABLE_DEV_AUTH=true and CONNECTORS_ALLOW_PRIVATE_HOSTS=true in apps/web/.env');
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
