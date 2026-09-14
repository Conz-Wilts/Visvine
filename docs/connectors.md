# Connectors

A connector lets Visvine reach a service it doesn't own — an API, a database, another MCP server —
from inside a sandbox, under a perimeter an admin wrote down. This page is the operator and author
guide: what you can connect, how a connector knows who is asking, and how agents fit.

Code lives in `apps/web/lib/connectors/`. The MCP tools that drive it are `list_connectors`,
`run_connector` (gated on `connectors:use`) and `set_connector_secret` (gated on `secrets:write`,
space admins only) — all actions in `lib/actions/defs/`, reached through the one `visvine` MCP tool (`lib/mcp/gateway.ts`) and `POST /api/actions/<name>`.

## What a connector is

One note, `connectors/<name>.md`. Its frontmatter declares the perimeter; its body is JavaScript
documentation the model reads before writing code.

```yaml
---
type: connector
title: "Stripe"
description: "Stripe billing account"
hosts:
  - api.stripe.com
env:
  STRIPE_KEY: "{{secret:STRIPE_KEY}}"
timeout_ms: 30000
---
Stripe billing. List customers:

    const res = await fetch('https://api.stripe.com/v1/customers', {
      headers: { Authorization: `Bearer ${env.STRIPE_KEY}` },
    })
    return JSON.parse(res.body).data
```

Two invariants hold everywhere:

- **Secret values never appear in a note** — only `{{secret:NAME}}` references, resolved server-side
  at run time from the space's encrypted secret store.
- **`hosts:` is written literally**, never interpolated. An empty `hosts:` means no network at all.

### Actions

Model-written JavaScript is the escape hatch; the reviewable, deterministic path is a **named
action** — code an author wrote once, in the note, that callers run by name with arguments:

```yaml
actions:
  list_customers:
    description: "Customers, newest first"
    params: { limit: { type: integer, default: 10 } }      # documentation for the caller, stored verbatim
    code: |
      const r = await fetch(`https://api.stripe.com/v1/customers?limit=${args.limit ?? 10}`, {
        headers: { Authorization: `Bearer ${env.STRIPE_KEY}` },
      })
      return JSON.parse(r.body).data
```

Every runner takes `{ action, args }` in place of `{ code }`: MCP `run_connector`
(`action` + `args`, exactly one of `code`/`action`), the agent tool (`run_connector {name, action,
args}` — its description lists each connector's actions), a Tool's `visvine.connectors.call(name,
{ action, args })`, and the console. `list_connectors` reports `actions: [{ name, description,
params }]`. Action code runs in the same isolate under the same perimeter with `args` installed as
a deep-frozen global — an action is convenience and review, never a wider door. Names match
`^[a-z][a-z0-9_]{0,63}$`; at most 32 actions, 32KB of code each; `params` is not validated against
`args` at run time.

## Adding one from the catalog

**Create → Connector** opens one searchable list of services, filterable by All / Connected /
Not connected, with an ⓘ per row. Pick a service, paste the credential
its form asks for, save. What happens is exactly what an admin would do by hand: the note is
written at `connectors/<name>.md` with the service's hosts and a body that teaches agents
its API, and each secret field is stored through the secrets API — never in the note. OAuth
entries (Google, Microsoft, any MCP server) store the OAuth client; people connect their
own account afterwards from the connector's page. The recipes are `lib/connectors/catalog.ts`.

## Who can use one

Access is Visvine's own machinery. There is no separate connector permission system.

```
sign in to Visvine
  └─ member of the space
      └─ can see connectors/<name>.md (note grants)
          └─ run_connector, with the connectors:use OAuth scope
```

Revoking someone's grant on the note revokes their access. Nothing else needs changing.

## The runtime

Code runs in a QuickJS isolate with no filesystem, no sockets, no `require`, no timers and no real
`fetch`. Its entire reach is these capabilities, each gated by the perimeter:

| Capability | What it does |
|---|---|
| `fetch(url, init)` | One HTTP request. Returns `{ status, ok, headers, body, truncated, hops }` — `body` is a **string**, call `JSON.parse` yourself. Redirects are not followed unless `init.follow` (1–3) is set; each hop is re-judged against `hosts:`/`allow:` and the SSRF guard exactly like the first request, `hops` says how many were taken, and a 3xx that was not followed carries `location`. |
| `sql(dsn, query)` | One **read-only** statement against Postgres or MySQL. Enforced twice: a statement guard, then `BEGIN TRANSACTION READ ONLY`. |
| `mcp(url, headers?)` | `.listTools()` and `.callTool(name, args)` against a remote MCP server. Built on `fetch`, so the same gate applies. |
| `sleep(ms)` | Bounded by the run deadline. For backing off a 429. |
| `env` | The connector's resolved secrets, frozen. |
| `args` | Action calls only: the caller's arguments, deep-frozen. |
| `console.log` | Captured into a capped buffer. |
| `visvine.crypto.*` | Hashing and signing, strings in and out: `hmac(alg, key, data, { keyEncoding?, encoding? })` and `hash(alg, data, { encoding? })` (`alg` sha256 \| sha1 \| sha512; `keyEncoding` utf8 \| hex \| base64; `encoding` hex \| base64), `randomHex(bytes ≤ 64)`, `base64.encode(utf8)` / `base64.decode(b64)`, `timingSafeEqual(a, b)`, and `sigv4({ accessKeyEnv, secretEnv, sessionTokenEnv?, region, service, method, url, headers?, body? })` → `{ headers }` (Authorization, x-amz-date, x-amz-content-sha256, host, …) ready to pass to `fetch`. `sigv4` reads the AWS keys from `env` **by name**, host-side, so the secret never has to be a local in connector code. All async. |
| `visvine.state.get(key)` / `.set(key, value)` | The connector's memory between runs — cursors, ETags, "last seen" ids. Per (space, connector note); shared by everyone who runs it; 64KB a value, 100 keys, `set(key, null)` clears; a set past the key cap is refused with a readable error rather than evicting anything. |

Limits: 30s per run (`timeout_ms`, max 120s), 15s per request, 256KB of output, 1,000 rows per query,
4 concurrent runs process-wide — and per space, `CONNECTOR_RUNS_PER_MINUTE` runs a minute (default
120) and 2 concurrent runs. Over either, the run is refused with `rate_limited` (HTTP/MCP 429, bridge
`rate_limited`) before any secret is resolved.

### What you can and cannot build

**Can:** any HTTPS API with a key or token in a header — reads *and* writes (POST/PUT/DELETE all
work); read-only database queries; remote MCP servers; several calls chained in one run
(`Promise.all` works); **AWS SigV4 and HMAC-signed requests** (`visvine.crypto`); **remembering
small things between runs** — a sync cursor, an ETag — with `visvine.state` (64KB a value, 100 keys
a connector); following a redirect chain when asked (`follow`); **receiving webhooks** — a `webhook:`
block gives the note an inbound address whose deliveries wake the agents that listen for it (see
[Receiving webhooks](#receiving-webhooks)).

**Cannot:**

| | Why |
|---|---|
| A vendor's SDK | no `require`/`import`, no npm |
| Running code on a webhook | a delivery is *data* for the next agent run, not a call — the connector's own code never executes inbound |
| Jobs over 30 seconds | hard deadline |
| Database writes | `sql()` is read-only by construction |
| Reaching a private network | the SSRF guard blocks private address space; `CONNECTORS_ALLOW_PRIVATE_HOSTS` is dev-only and throws in production |
| Storing data between runs | `visvine.state` is for cursors, not records — anything the space should keep belongs in a context note |

## Three ways a connector proves who is calling

This is the part worth understanding, because the three are easy to confuse and they answer
different questions.

| | Question answered | Declared as | Who the far side sees |
|---|---|---|---|
| **Shared secret** | which *system* is calling | `env:` | one account, the same for everyone |
| **Actor assertion** | which *person* it is for | `identity:` | the person — if the far side trusts us |
| **OAuth connection** | which *person's account* to use | `auth:` | the person's own account at that service |

### Shared secret — the default

`env: { API_KEY: "{{secret:API_KEY}}" }`. One credential, one view, every member sees the same
thing. Right for Stripe, Companies House, OpenAI — services where there is one company account and
no per-person view to have.

**Storing the value.** Two doors, both admin-only, both onto the same store
(`lib/connectors/secretStore.ts`):

| | Who | When |
|---|---|---|
| The connector page's Environment card | an admin in a browser | the normal path; rotation is a click |
| `set_connector_secret` (MCP) | an admin's client, holding `secrets:write` | building a connector end to end in one pass |

The tool exists so that "write the note, store the key, prove it works" is one unbroken sequence
rather than three steps with a human in the middle of it. It is narrower than the page in three ways
that matter:

- **The name must already be referenced** by the connector note. You cannot invent a secret name —
  only fill in a blank the note declared. The note, which is reviewable and visible, is what decides
  which credentials may exist.
- **No overwrite by default.** Re-running a setup script gets `already_set` rather than silently
  replacing a working credential; `overwrite: true` is how an admin means it.
- **Admin is re-derived live**, through `resolveContext`, on every call — never read off the token.

`secrets:write` is its own scope and deliberately not part of `connectors:use`: a token granted to
*call* Stripe must not thereby be able to *replace* the Stripe key. A client has to ask for it at
consent, and the scope is necessary but never sufficient — the admin check sits underneath it.

It is **not** on the agent runtime surface (`lib/agents/tools.ts`). An unattended 3am run has no
business rotating a credential, and an agent that could would be an agent that could lock a space out
of its own connectors.

Storing is still one-way. Nothing reads a value back — not the page, not a tool, not an admin. Keep
the credential wherever you normally keep credentials before you store it here.

### `identity:` — attesting who the caller is

For a service **you own**, or a partner who agrees to verify your signature. Visvine's runtime signs
a short-lived statement naming whoever triggered the run and stamps it on the request. The far side
checks the signature and applies its own per-person rules.

```yaml
identity:
  audience: blackbird-data          # the `aud` the upstream verifies
  secret: "{{secret:ACTOR_KEY}}"    # HS256 key, shared with that upstream only
  hosts:                            # narrow it — see below
    - blackbird-data-xxxx.a.run.app
  ttl_s: 120
```

Three things make it trustworthy, all enforced outside the isolate:

- Connector code **cannot read the signing key** — it never enters `env`.
- Connector code **cannot set that header** — `hostFetch` drops a caller-supplied copy and stamps
  after normalisation.
- Connector code **cannot choose the name** — it comes from the principal who ran it.

Narrow `identity.hosts` whenever a note reaches more than one service, or the second vendor receives
a colleague's email address for no reason.

**This does not work against arbitrary SaaS.** Notion, Slack, Google and Attio will not verify a
Visvine-signed assertion; they expect their own OAuth. Use `identity:` only where both ends are
yours or agreed.

### `auth:` — an OAuth connection Visvine holds

For services that authenticate **people**: Notion, Linear, Atlassian, GitHub. Visvine does the
browser flow once and keeps the tokens.

```yaml
auth:
  provider: notion                  # stable key for the stored connection
  mode: user                        # user | space  ← the important choice
  discover: https://mcp.notion.com/mcp
  scopes: [read_content]
  hosts:                            # where the bearer may be sent
    - mcp.notion.com
```

Endpoints come from `discover:` (RFC 9728 → RFC 8414 metadata, the same walk an MCP client does) or
from explicit `authorize_url` + `token_url`. Where the server supports dynamic registration
(RFC 7591), Visvine registers itself at first connect — **which is why adding an MCP server is a URL
rather than a developer-account signup.** A hand-registered client goes in `client_id`, and
`client_secret` must be a `{{secret:NAME}}` reference, never a literal.

Two more keys:

- **`client_id: platform:google`** uses the deployment's own OAuth client — the
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` env pair the app's sign-in already holds — so a space
  connects Google without registering anything. The credential never enters a note, a secret row, or
  the isolate; `client_secret` must be omitted. A note may always carry its own client instead.
- **`params:`** — extra literal query parameters for the authorize URL. Google needs
  `access_type: offline` (and `prompt: consent` to re-issue) or it never returns a refresh token and
  the connection dies after an hour. Keys the flow itself owns (`state`, `redirect_uri`,
  `code_challenge`, `scope`, …) are refused, and no `{{secret:…}}` may appear in a value.

Like `identity:`, the token is stamped by the host, never placed in `env`, and a caller-supplied
`Authorization` header is dropped.

## `mode: user` vs `mode: space`

The single most consequential line in an `auth:` block.

| | `mode: user` | `mode: space` |
|---|---|---|
| Who connects | each person, their own account | an admin, once |
| Whose data you see | yours | **whoever connected it** |
| First use | a connect link, then retry | already connected |
| Works for agents | yes, once the member the agent runs as has connected | **yes** |
| Right for | Notion, Gmail, personal drives | shared workspaces, service accounts |

**`mode: space` transfers privilege.** Everyone who can run the connector acts as the account that
was connected. That is not a side effect, it is the point — it is what lets an agent run at 3am —
but it means sharing the note now shares somebody's access. The console and the connections endpoint
both surface `actsAs` for exactly this reason; never present a shared connection as "your account".

### Connecting, and what happens when you haven't

A run with no usable connection does not fail with a bare 401. It returns a readable step-up:

> No notion account is connected for you. Connect your own account to continue:
> `https://…/api/connectors/oauth/start?space=…&connector=notion`

Click it, approve at the provider, retry. A connector isolate cannot open a browser, so a link is
the only thing that helps someone sitting in Claude Desktop.

The same wording appears when a connection **breaks** — revoked, password changed, person left.
Broken connections are recorded rather than deleted (`broken_at`, `broken_reason`), so an agent that
dies overnight leaves an explanation.

### Managing connections

```
GET    /api/spaces/<spaceId>/connectors/<name>/connections
DELETE /api/spaces/<spaceId>/connectors/<name>/connections?user=<id>
```

Admins see every connection; a member sees the shared one and their own. Anyone may disconnect
their own; removing the shared one, or somebody else's, is an admin act.

Deleting a Visvine account deletes that person's **personal** connections. Space connections survive
— they belong to the space, not to whoever clicked Connect.

## Agents and connectors

An agent is two notes: `agents/<name>.md` (the brief, member-writable) and `agents/live/<name>.md`
(activation, **admin-only**). See `docs/agents.md`.

A scheduled run has no person of its own, so one is named for it:

```yaml
# agents/live/<name>.md — admin-only
active: true
schedule: daily
at: "07:00"
runs_as: <user id>        # optional
```

- **Default** — the brief's author. An agent reaches exactly what its author reaches, no more.
- **`runs_as`** — an admin repoints it at somebody else, typically a service account.

`runs_as` lives on the **live** note deliberately. Writing your own agent must not be a way to make
it act as somebody with more access than you; activation is an admin's approval, and so is this.
Repointing it does not reschedule the agent — whose credentials a run spends is not a scheduling
fact.

**Two consequences worth stating plainly:**

1. **A `mode: user` connector works unattended once its person has connected.** A run resolves the
   connection of the member it runs as (`runs_as`, else the brief's author): if that member has
   clicked Connect once — with a provider that grants offline access, see `params:` above — every
   later run renews and spends their token with nobody present. A member who never connected fails
   with the step-up message rather than silently borrowing whoever's token is nearest.
2. **The far side's audit log will name that person.** If an agent runs on Tom's connection, Notion
   records Tom. Point `runs_as` at a service account wherever the provider offers one.

If Tom leaves, every agent running as him breaks at once. That is a `broken` connection with a
reason attached — make sure an admin, not just Tom, is watching for it.

## Receiving webhooks

Everything above is outbound: a connector does something when someone runs it. A `webhook:` block
turns the note into an inbound address as well. The provider posts to it, Visvine verifies the
delivery, and every **active agent whose live note says `on.webhook: <connector>`** gets it as an
event on its next run (`docs/agents.md` → Triggers). No connector code runs on receipt, nothing is
written to a note, and an admin can see the last deliveries on the connector's page.

```yaml
webhook:
  signature: github                    # none | token | hmac-sha256 | hmac-sha1 | github | stripe | slack | hubspot | linear
  secret: "{{secret:GH_WEBHOOK_SECRET}}"   # required unless signature: none
  header: x-hub-signature-256          # required for token / hmac-*; presets fill it in
  prefix: "sha256="                    # stripped before comparing (presets fill it in)
  encoding: hex                        # hex | base64 (default hex; hubspot preset = base64)
  id_header: x-github-delivery         # dedupes redeliveries; default sha256(body)
  event_field: "$.action"              # dotted path into a JSON body, for the one-line summary
  max_bytes: 262144                    # ≤ 1048576
```

`webhook: true` is the shorthand for `signature: none` — the URL token is the only credential, for
providers that cannot sign. The `secret` is a `{{secret:NAME}}` reference like every other, stored
on the connector's page — but it is resolved **only** by the inbound route and is deliberately not
part of `env`: the connector's own code never sees the key that authenticates its inbox.

**The address** is `POST /api/hooks/<space>/<connector>/<token>`. The token is 32 random bytes,
minted the first time an admin opens the connector page's Webhook card (stored encrypted as
`WEBHOOK_TOKEN_<NAME>` beside the other secrets) and rotated from the same card — the old URL stops
working at once. Treat the URL as a credential.

**What a delivery goes through**, in order: a per-hook rate bucket (60/min, 429); the note — no
note, not a connector, no `webhook:` block or a wrong token are all the
same 404, so the address cannot be used to enumerate a space; the size cap (413, before the body is
read); the declared signature scheme (401 plus one audit line, `webhook rejected: signature`); then
one `agent_events` row per listening agent, deduped on `id_header` (or a body hash) while a copy is
still pending, and `202 {accepted: n}` — `n` may be 0 when nobody is listening. Stripe, Slack and
HubSpot presets also refuse timestamps more than five minutes off.

**What the agent sees**: `<connector> <event> (<delivery id>)` as the summary, and a payload of
`{ headers, body }` — headers from a short allowlist (content type, user agent, the provider's
event/delivery ids; never a signature), body parsed as JSON when the provider says it is JSON, else
text, clipped to the run's per-event budget. It is data, not instructions; the run message says so.

**Setting one up**: add the block, open the connector page as an admin, copy the URL into the
provider's webhook settings, set the signing secret on the page, and put `on: { webhook: <name> }`
in an agent's live note. The card lists which agents are listening and the last ten deliveries.

## Do you even need a connector?

Sometimes not. If a person is working in Claude Desktop, they can connect Notion **there**, and
Claude will pass data between Notion and Visvine for them. That costs you nothing to build.

A connector earns its place when Claude isn't in the loop:

- **Your own APIs**, where Visvine knows things the client can't (see `identity:`)
- **Agents and scheduled jobs** — nobody is present
- **Tools** — the React apps inside a space reach data through the bridge, not through Claude
- **Key-based services** you want available to everyone without each person configuring anything

## Configuration

| Variable | Purpose |
|---|---|
| `SECRETS_KEY` | 64 hex chars. Encrypts stored secrets and OAuth tokens. |
| `AUTH_SECRET` | Signs the pending-authorization cookie during a connect flow. |
| `NEXT_PUBLIC_APP_URL` | The origin in connect links and the OAuth redirect URI. Must match what providers have registered. |
| `CONNECTORS_ALLOW_PRIVATE_HOSTS` | Dev only — lets connectors reach localhost/VPC. Throws in production. |
| `CONNECTOR_RUNS_PER_MINUTE` | Per-space run budget over a sliding minute (default 120). Concurrency per space is fixed at 2. |

## Reference

| File | What it holds |
|---|---|
| `config.ts` | Perimeter parsing, the allowlist grammar, secret references, redaction |
| `secretStore.ts` | The space secret store — validation, encryption and the audit line, shared by the admin route and `set_connector_secret`. Write-only by construction; does no authorization of its own. |
| `auth.ts` | The `auth:` block; `user`/`space` mode |
| `oauth.ts` | Discovery, PKCE, dynamic registration, token exchange and refresh |
| `connections.ts` | Stored connections, refresh, the step-up message |
| `identity.ts` | The `identity:` block and assertion minting |
| `webhook.ts` | The `webhook:` block — parsing and every signature scheme, pure |
| `webhookInbound.ts` | The inbound route's logic: URL token, rate bucket, size cap, verify, enqueue; token provisioning |
| `hostFetch.ts` | The egress gate — where every header is stamped; opt-in `follow` re-gates every hop |
| `hostCrypto.ts` | `visvine.crypto` — HMAC/hash/base64/SigV4, keys for SigV4 read from `env` by name |
| `hostState.ts` | `visvine.state` — the `connector_state` table, Tool-state caps |
| `quota.ts` | Per-space runs/minute window and concurrency cap |
| `hostSql.ts`, `postgres.ts`, `mysql.ts` | The read-only SQL capability |
| `hostMcp.ts` | The MCP capability |
| `isolate.ts` | The QuickJS runtime |
| `service.ts` | The one execution path — notes, secrets, isolate, audit |

Every run writes an audit line (`logAudit`, action `connector`), success or refusal.
