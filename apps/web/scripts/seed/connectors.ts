/**
 * The demo connectors, as content: every note and secret the three connector
 * fixtures put in a space. scripts/seed/run.ts writes them into Blackbird Ventures, and
 * scripts/add-connector-demos.ts writes (or removes) one set on any local space.
 *
 *   demo   connectors/sandbox.md (http → /api/dev/connector-sandbox) and
 *          connectors/appdb.md (postgres → the local dev database, read-only)
 *   funds  connectors/fund-metrics.md (http → /api/dev/fund-metrics) and the
 *          fund-admin/ notes that hang off it — a sandbox fund administrator
 *          with invented funds, kept out of `funds/` so it is never read as a
 *          real space's fund table
 *   oauth  connectors/crm.md (OAuth2 client credentials → /api/dev/oauth-crm)
 *
 * The secret VALUES must match what the dev routes expect; each route reads the
 * same env var with the same fallback (app/api/dev/*).
 *
 * No `connectors/index.md` here: the folder's index is the app's, and its
 * child block lists the connectors as they land.
 */

import type { Note } from './notes'

export type ConnectorDemo = 'demo' | 'funds' | 'oauth'
export const CONNECTOR_DEMOS: readonly ConnectorDemo[] = ['demo', 'funds', 'oauth']

export interface ConnectorDemoSet {
  notes: Note[]
  secrets: Array<{ name: string; value: string }>
}

const appOrigin = () => (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')

/** The DSN the app itself uses — the postgres connector connects as a foreign database. */
function resolveDsn(): string {
  const direct = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL
  if (direct) return direct
  if (process.env.DB_HOST) {
    const pw = encodeURIComponent(process.env.DB_PASSWORD ?? '')
    return `postgresql://${process.env.DB_USER}:${pw}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME}`
  }
  return 'postgresql://postgres:postgres@127.0.0.1:5432/app'
}

export function connectorDemo(kind: ConnectorDemo, spaceId: string): ConnectorDemoSet {
  switch (kind) {
    case 'demo':
      return sandboxAndAppdb(spaceId)
    case 'funds':
      return fundMetrics()
    case 'oauth':
      return oauthCrm()
  }
}

function sandboxAndAppdb(spaceId: string): ConnectorDemoSet {
  /** Kept in step with the same expression in the sandbox route. */
  const SANDBOX_KEY = process.env.CONNECTOR_SANDBOX_KEY || 'sk_sandbox_local_dev'
  const origin = appOrigin()
  const sandboxBaseUrl = `${origin}/api/dev/connector-sandbox`
  /** What `hosts:` gates on — host[:port], never a URL. */
  const sandboxHost = new URL(origin).host
  /** The DSN's own host, which is what the perimeter must list for `sql()`. */
  const appdbHost = (() => {
    const url = new URL(resolveDsn())
    return url.port ? `${url.hostname}:${url.port}` : url.hostname
  })()

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

\`connector_secrets\` holds connector secret ciphertext and \`oauth_auth_codes\`
holds live authorization codes. Neither is useful to you and both are off
limits — the read-only transaction does not make them any less sensitive.
`;

  return {
    notes: [
      { path: 'connectors/sandbox.md', content: SANDBOX_NOTE },
      { path: 'connectors/appdb.md', content: APPDB_NOTE },
    ],
    secrets: [
      { name: 'SANDBOX_KEY', value: SANDBOX_KEY },
      { name: 'APPDB_DSN', value: resolveDsn() },
    ],
  }
}

function fundMetrics(): ConnectorDemoSet {
  /** Kept in step with the same expression in the fund-metrics route. */
  const FUND_KEY = process.env.CONNECTOR_FUND_METRICS_KEY || 'sk_fundmetrics_local_dev'
  const origin = appOrigin()
  const apiHost = new URL(origin).host
  const apiBase = `${origin}/api/dev/fund-metrics`

const FUND_METRICS_NOTE = `---
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

const FUND_PORTFOLIO_NOTE = `---
type: note
title: Fund portfolio
description: The sandbox fund administrator's three invented funds, and where their numbers come from
---

Three active vehicles in the sample fund-admin API this connector fixture points at. Live figures are never typed into this note — pull them
from the [Fund Metrics API](/connectors/fund-metrics.md) connector, which is the
system of record.

| Fund | Vintage | Strategy | Commitment |
| --- | --- | --- | --- |
| Kereru Fund III (\`fund_bb3\`) | 2019 | Early-stage venture | $250M |
| Kereru Fund IV (\`fund_bb4\`) | 2022 | Early-stage venture | $400M |
| Kereru Growth I (\`fund_bbg1\`) | 2023 | Growth | $300M |

## What to know before quoting a number

- **Fund III is the mature book.** It carries the marks that move the firm's
  headline TVPI; one position alone is the majority of its fair value.
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

const FUNDS_INDEX = `---
title: Fund admin sandbox
description: A sample fund administrator for exercising the fund-metrics connector.
tags: [connectors, sandbox]
---

Invented funds served by the dev fund-metrics API, read through the
fund-metrics connector.
`;

  return {
    notes: [
      { path: 'connectors/fund-metrics.md', content: FUND_METRICS_NOTE },
      { path: 'fund-admin/index.md', content: FUNDS_INDEX },
      { path: 'fund-admin/fund-portfolio.md', content: FUND_PORTFOLIO_NOTE },
    ],
    secrets: [{ name: 'FUND_METRICS_KEY', value: FUND_KEY }],
  }
}

function oauthCrm(): ConnectorDemoSet {
  /** Kept in step with the same expressions in the oauth-crm route. */
  const CLIENT_ID = process.env.CONNECTOR_OAUTH_CLIENT_ID || 'crm_client_local_dev'
  const CLIENT_SECRET = process.env.CONNECTOR_OAUTH_CLIENT_SECRET || 'sk_crm_secret_local_dev'
  const origin = appOrigin()
  const apiHost = new URL(origin).host
  const apiBase = `${origin}/api/dev/oauth-crm`

const CRM_NOTE = `---
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

  return {
    notes: [{ path: 'connectors/crm.md', content: CRM_NOTE }],
    secrets: [
      { name: 'CRM_CLIENT_ID', value: CLIENT_ID },
      { name: 'CRM_CLIENT_SECRET', value: CLIENT_SECRET },
    ],
  }
}
