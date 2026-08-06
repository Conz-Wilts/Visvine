/**
 * Seeds the hard connector test case: a vendor API with OAuth2, short-lived
 * tokens, refresh-token rotation, rate limiting and cursor pagination — none of
 * which the platform knows anything about. Everything an agent needs to survive
 * it lives in the note's prose.
 *
 * Writes into the community's SHARED brain:
 *   • connectors/crm.md — v2 connector against /api/dev/oauth-crm, with the
 *     client id + secret as env, and a body that teaches the token dance.
 *   • the CRM_CLIENT_ID / CRM_CLIENT_SECRET secrets, encrypted under SECRETS_KEY.
 *
 * Usage:
 *   pnpm db:connectors:oauth                      # community:blackbird-ventures
 *   pnpm db:connectors:oauth <communityId>
 *   pnpm db:connectors:oauth <communityId> --remove
 */

import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import prisma from '../lib/prisma';
import { OWNER_ALIAS_NAME } from '../lib/types/context';
import { encryptSecret } from '../lib/crypto/secrets';
import { syncContextLinksBulk } from '../lib/notes/entityLinks';

/** Kept in step with the same expressions in the oauth-crm route by hand. */
const CLIENT_ID = process.env.CONNECTOR_OAUTH_CLIENT_ID || 'crm_client_local_dev';
const CLIENT_SECRET = process.env.CONNECTOR_OAUTH_CLIENT_SECRET || 'sk_crm_secret_local_dev';

const communityId = process.argv[2]?.startsWith('--')
  ? 'community:blackbird-ventures'
  : (process.argv[2] ?? 'community:blackbird-ventures');
const REMOVE = process.argv.includes('--remove');
const SHARED = 'shared';

const appOrigin = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const apiHost = new URL(appOrigin).host;
const apiBase = `${appOrigin}/api/dev/oauth-crm`;

const CONNECTOR_NOTE = `---
type: connector
alias: http
title: CRM (OAuth2)
description: Customer CRM — OAuth2 client-credentials, 5s access tokens, rotating refresh tokens, 6 req/10s rate limit, cursor pagination
hosts:
  - ${apiHost}
allow:
  # Prefix rules: the \`*\` is glued to the path. A \`/path/*\` form would be a
  # single-segment wildcard and would refuse deeper paths.
  - "POST /api/dev/oauth-crm/oauth/token"
  - "GET /api/dev/oauth-crm/v1*"
env:
  CRM_API: "${apiBase}"
  CRM_CLIENT_ID: "{{secret:CRM_CLIENT_ID}}"
  CRM_CLIENT_SECRET: "{{secret:CRM_CLIENT_SECRET}}"
timeout_ms: 60000
---

The customer CRM. It is an OAuth2 service, not an API-key service, so a single
call will not work — you must get a token first, and be ready for it to expire
mid-task.

\`env.CRM_CLIENT_ID\` and \`env.CRM_CLIENT_SECRET\` are already in the isolate,
resolved server-side. Never print them, and never put a token in a note.

## 1. Get an access token

    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.CRM_CLIENT_ID,
      client_secret: env.CRM_CLIENT_SECRET,
    }).toString()
    const res = await fetch(\`\${env.CRM_API}/oauth/token\`, { method: 'POST', body: form })
    let { access_token, refresh_token } = JSON.parse(res.body)

**Access tokens live 5 seconds.** That is deliberately short; treat every call
as though the token may already be dead.

## 2. Refresh when a call returns 401

An expired token comes back as \`401\` with \`{"error":"invalid_token"}\`. Refresh
tokens **rotate** — each one works once, and the response carries the next one.
If the refresh token is also spent, start again at step 1.

## 3. Respect the rate limit

6 requests per rolling 10 seconds per client. Over that you get \`429\` with a
\`retry_after\` in the body. \`await sleep(ms)\` and retry — do not hammer. Every
2xx carries \`x-ratelimit-remaining\`.

## 4. Paginate

\`GET /v1/contacts\` returns 2 contacts and a \`next_cursor\`. Keep passing it back
as \`?cursor=\` until \`next_cursor\` is \`null\`.

## Code that survives all three

Write the helper once and reuse it — this is the shape that works:

    const tokenForm = (extra) =>
      new URLSearchParams({ client_id: env.CRM_CLIENT_ID, client_secret: env.CRM_CLIENT_SECRET, ...extra }).toString()

    let token = null
    const login = async () => {
      const res = await fetch(\`\${env.CRM_API}/oauth/token\`, {
        method: 'POST',
        body: tokenForm({ grant_type: 'client_credentials' }),
      })
      token = JSON.parse(res.body).access_token
    }

    // Refreshes on 401, waits out 429, gives up after five tries.
    const get = async (path) => {
      if (!token) await login()
      for (let attempt = 0; attempt < 5; attempt++) {
        const res = await fetch(\`\${env.CRM_API}\${path}\`, {
          headers: { Authorization: \`Bearer \${token}\` },
        })
        if (res.status === 200) return JSON.parse(res.body)
        if (res.status === 401) { await login(); continue }
        if (res.status === 429) {
          await sleep((JSON.parse(res.body).retry_after ?? 3) * 1000)
          continue
        }
        throw new Error(\`CRM \${res.status}: \${res.body.slice(0, 200)}\`)
      }
      throw new Error(\`CRM gave up on \${path}\`)
    }

    const contacts = []
    let cursor = null
    do {
      const page = await get(\`/v1/contacts\${cursor ? \`?cursor=\${cursor}\` : ''}\`)
      contacts.push(...page.contacts)
      cursor = page.next_cursor
    } while (cursor)

    return { count: contacts.length, contacts }

## Endpoints

| Call | Notes |
| --- | --- |
| \`POST /oauth/token\` | \`client_credentials\` or \`refresh_token\` grant, form-encoded. Basic auth also accepted. |
| \`GET /v1/me\` | Cheap probe — confirms the token is live. |
| \`GET /v1/contacts?cursor=\` | 2 per page. \`arr_usd\` is whole dollars; \`stage\` is \`customer\`/\`trial\`/\`churned\`. |

## Guard rails

- The isolate may only reach \`${apiHost}\`, and only the two paths above.
- Tokens are short-lived by design; do not try to cache one across runs — each
  run gets a fresh isolate that remembers nothing.
`;

const NOTES = [{ path: 'connectors/crm.md', content: CONNECTOR_NOTE }];

const SECRETS = [
  { name: 'CRM_CLIENT_ID', value: CLIENT_ID },
  { name: 'CRM_CLIENT_SECRET', value: CLIENT_SECRET },
];

async function main() {
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { id: true, name: true },
  });
  if (!community) throw new Error(`community ${communityId} not found — run \`pnpm db:seed\` first`);

  if (REMOVE) {
    const notes = await prisma.communityNote.deleteMany({
      where: { communityId, ownerKey: SHARED, path: { in: NOTES.map((n) => n.path) } },
    });
    const secrets = await prisma.communitySecret.deleteMany({
      where: { communityId, name: { in: SECRETS.map((s) => s.name) } },
    });
    await syncContextLinksBulk({ communityId, ownerKey: SHARED }, NOTES.map((n) => n.path));
    console.log(`Removed ${notes.count} note(s) and ${secrets.count} secret(s) from ${community.name}`);
    return;
  }

  const owner =
    (await prisma.userAlias.findFirst({
      where: { communityId, aliasName: OWNER_ALIAS_NAME },
      select: { userId: true },
    })) ?? (await prisma.userCommunity.findFirst({ where: { communityId }, select: { userId: true } }));
  if (!owner) throw new Error(`community ${communityId} has no members to attribute the note to`);

  for (const note of NOTES) {
    await prisma.communityNote.upsert({
      where: { note_identity: { communityId, ownerKey: SHARED, path: note.path } },
      create: { communityId, ownerKey: SHARED, path: note.path, content: note.content, createdBy: owner.userId },
      update: { content: note.content, deletedAt: null, deletedPath: null },
    });
  }

  await syncContextLinksBulk(
    { communityId, ownerKey: SHARED },
    [],
    NOTES.map((n) => [n.path, n.content] as [string, string]),
  );

  for (const secret of SECRETS) {
    await prisma.communitySecret.upsert({
      where: { secret_identity: { communityId, name: secret.name } },
      create: {
        communityId,
        name: secret.name,
        ciphertext: encryptSecret(secret.value),
        createdBy: 'add-oauth-crm-demo',
      },
      update: { ciphertext: encryptSecret(secret.value), createdBy: 'add-oauth-crm-demo' },
    });
  }

  console.log(`=== Seeded OAuth CRM connector into ${community.name} (${communityId}) ===`);
  for (const note of NOTES) console.log(`  note   shared:${note.path}`);
  for (const secret of SECRETS) console.log(`  secret ${secret.name}`);
  console.log(`\n  API: ${apiBase}  (host gate: ${apiHost})`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
