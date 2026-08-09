# Connectors — one runtime, freeform behavior, deterministic perimeter

Status: v3 shipped. The runtime is an in-process JavaScript isolate; the v2
sandboxed shell and its two drivers are gone.

## Why

Today `alias` (http | postgres | mysql | mcp) picks an executor we wrote. Every
new kind of integration means new platform code: an executor, an MCP tool, a
tester UI. Companies differ in env vars, auth schemes, token dances — a fixed
executor can never keep up.

We replace all executors with **one runtime: a sandboxed JavaScript isolate**,
and split a connector into two halves:

- **Frontmatter = perimeter.** Small, deterministic, machine-enforced: which
  hosts it may reach, which secrets it gets (as env vars), limits. This is the
  security boundary and it stays YAML — free prose must never be able to widen
  what a connector can reach, or a prompt-injected note becomes an exfil vector.
- **Body = behavior.** Free prose: what the service is, how to call it, example
  code. Written by hand or by an agent. Any auth scheme, any token dance, any
  vendor API — the note teaches, the agent writes JS, the perimeter contains
  it. No platform code per HTTP service.

The note stays the memory: creating a connector = writing a note (by hand or
via MCP) + storing its secrets in the console. No bespoke creation code path.

## Frontmatter shape

```yaml
---
type: connector
title: Stripe
alias: http                   # cosmetic only — chip colour/icon, any string
hosts:
  - api.stripe.com            # literal, SSRF-checked — never from a secret
allow:                        # optional method+path rules (see enforcement note)
  - "GET /v1/customers*"
env:
  STRIPE_KEY: "{{secret:STRIPE_KEY}}"   # values injected into the sandbox only
timeout_ms: 30000
---
Stripe billing account. List customers:

    const res = await fetch('https://api.stripe.com/v1/customers', {
      headers: { Authorization: `Bearer ${env.STRIPE_KEY}` },
    })
    return JSON.parse(res.body).data

Customers, charges and invoices are readable. Amounts are in cents.
```

`alias` stops selecting an executor and becomes pure display metadata — any
string, coloured by the same `Node.alias` chip mechanism (`entityLinks.ts`
already treats it as an opaque string, so nothing in the sync changes). A note
is v2 when it declares `hosts:` or `env:`; otherwise the legacy parser applies.

## Security model

| Invariant | v1 | now |
|---|---|---|
| Secrets never in notes | `{{secret:NAME}}` refs in config | same syntax, only valid in `env:` |
| Host control / SSRF | literal `base_url` + dns check | literal `hosts:`; the isolate has no sockets — every call goes through a host function that resolves and refuses private space |
| Allowlist | matched in executor | `matchAllowlist` inside `hostFetch`, on **every** call including HTTPS |
| Isolation | in-process executor | QuickJS-WASM isolate: no filesystem, no process, no require/import, no timers, no real fetch |
| Redaction | `redactSecrets` on responses | `redactDeep` walks the returned structure; `redactSecrets` on logs, errors and denials |
| Audit | one line per call | one line per run, code included |

Known trade-offs, accepted deliberately:

- **Non-HTTP protocols need platform code.** A shell could run any binary; the
  isolate reaches only what we expose. Postgres, MySQL and MCP ship as host
  capabilities (`sql`, `mcp`); anything else — SFTP, Redis, gRPC — would be a
  new host function. Judged worth it: the market is SaaS REST APIs.
- **A timed-out run leaks one context.** Interrupting QuickJS mid-execution can
  leave objects alive that `JS_FreeRuntime` asserts on, and that assertion
  aborts the WASM module rather than throwing. So a failed dispose is caught,
  the context is left to the GC, and the cached module is dropped so the next
  run builds a clean one. Bounded and survivable; taking the process down is
  not.
- **SQL read-only** is the `sql()` capability's guarantee: a single
  SELECT-shaped statement inside `BEGIN TRANSACTION READ ONLY` with a
  statement timeout, per `lib/connectors/postgres.ts`.
- **DNS rebinding** remains possible in the window between
  `assertPubliclyRoutable` and the socket. Unchanged from v1/v2; the fix is to
  pin the resolved address into the fetch agent, not yet done.

## Agent surface

Four tools (`call_connector`, `query_connector`, `list_connector_tools`,
`call_mcp_connector`) collapse to two:

- `list_connectors` — unchanged in spirit.
- `run_connector(name, code)` — JavaScript in that connector's isolate. The
  globals are `fetch`, `sql`, `mcp`, `sleep`, `env` and `console`; the code is
  the body of an async function and `return`s the answer.

Creation-by-conversation falls out of composition: the agent writes
`connectors/stripe.md` via the notes MCP tools, admin stores the secret,
agent probes with `run_connector`, reads the error, edits, retries. Note the
`connectors/` folder is admin-only for writes regardless of folder grants
(`brainService.writeDenial`), so that first step needs an admin's token.

## Type UI (connector node page)

Same pattern as person → profile, event → event page. Four blocks, minimal
label text — shapes and states carry the meaning:

1. **Header** — name, status dot (ready / secret missing / invalid), one-line
   description.
2. **Perimeter** — host chips + secret chips (filled = stored, hollow =
   missing; click hollow to set). No headings.
3. **Docs** — rendered note body, edit-in-place.
4. **Console** — one panel replacing all three testers, running through the
   same `run_connector` path agents use. Test = reality by construction.

Connectors index keeps the card grid; icon/colour driven by `tag`.

## The runtime

`quickjs-emscripten-core` + `@jitl/quickjs-singlefile-cjs-release-sync`, both
halves of that pinned deliberately.

**singlefile**, because the meta-package's default resolves to a `wasmfile`
variant that loads its `.wasm` from `node_modules` **by path at runtime**, which
`output: "standalone"` never traces and the Docker image never copies. It works
in dev and `ENOENT`s on Cloud Run. The singlefile variant inlines the wasm.
`next.config.ts` lists it in `serverExternalPackages` alongside `pg`/`mysql2`.

**sync, not asyncify** — this one was learned the hard way. The obvious way to
give the isolate an `await`-able `fetch` is the asyncify transform, which
suspends the VM and unwinds the WASM stack for the duration of a host call. It
works for one call, usually two, and then corrupts: a refcount abort, an
out-of-bounds access, or simply the wrong value coming back, varying with the
shape of the calling code and the library version. Connectors need many calls —
an OAuth dance is two before it does anything useful, and pagination is
unbounded — so asyncify is unusable here.

Instead, host capabilities are **ordinary sync functions that return a QuickJS
promise** (`ctx.newPromise()`). The host settles it when the real work finishes
and pumps the job queue; the isolate's `await` continues from there. The VM is
never suspended, so there is no stack to corrupt, no re-entrancy window, and no
limit on how many calls a run may make. `Promise.all` is genuinely concurrent as
a side effect.

`isolated-vm` was rejected: v7 needs Node ≥24 and a native build; the image is
`node:20-alpine`.

Modules:

- `isolate.ts` — `runInIsolate(perimeter, code, options)`. Owns the QuickJS
  lifetime, the limits (64 MiB heap, 1 MiB stack, interrupt handler on the
  deadline), a run-scoped `AbortController`, a process-wide semaphore of 4, and
  the driver loop that pumps the job queue and waits on in-flight host work.
  Two ownership rules that are not obvious and both abort the process when
  broken: the context is created with `module.newContext()` so it owns its
  runtime (owning the runtime separately means disposing it after the context,
  which frees the capabilities' host references out from under the runtime they
  belong to); and capability/console function handles are kept alive for the
  context's lifetime rather than disposed after `setProp`, because the handle
  owns the host reference WASM calls back through.
- `perimeter.ts` — the pure gate: `hostAllowed`, `refuseHost`, `refusePath`.
- `hostFetch.ts` — the `fetch` capability and `sleep`. Order is load-bearing:
  scheme, method, path, host allowlist, allow rules, SSRF, then the socket.
  `redirect: 'manual'`, so a 3xx returns with `location` and re-issuing goes
  through the whole gate again.
- `hostSql.ts` — parses the DSN, gates its host, dispatches to
  `postgres.ts`/`mysql.ts`. Its denial names the **allowed** hosts and never
  the refused one, because that host is a substring of a decrypted secret.
- `hostMcp.ts` — JSON-RPC over `hostFetch`, so MCP inherits the same gate.
- `marshal.ts` — `marshalValue` (depth/node/string caps, both directions) and
  `redactDeep`. The v1 MCP executor redacted by
  `JSON.parse(redactSecrets(JSON.stringify(x)))`, which throws outright when a
  secret ends in a backslash; walking the structure cannot.

Two capabilities that look like exceptions and are not: `sleep` is not a timer
— it cannot schedule anything, only pause inside the run's own deadline, and
backing off a 429 is otherwise unwritable. `env` is a frozen namespace object,
so a variable named `fetch` is `env.fetch` and shadows nothing.

## Verification

`tests/connector-isolate.test.ts` carries the escape battery (one assertion per
absent global — `process`, `require`, `import()`, `Function('return this')`,
`std`/`os`, timers, `Buffer`, `WebAssembly`), the perimeter cases, the
timeout/memory/leak cases, the 25-sequential-calls regression, and the
allow-rule case that would have passed under the CONNECT tunnel and now fails.

Live, against `pnpm dev`: `pnpm db:connectors:demo` / `:funds` / `:oauth` to
seed, then `tsx scripts/verify-connectors-demo.ts` (service layer, 7 checks) and
`pnpm connectors:verify:funds` / `:oauth` (through the real MCP server, 10 and 9
checks). The OAuth suite is the one that matters: it exercises token expiry with
refresh, a 429 backoff loop, and cursor pagination — i.e. many host calls in one
run, which is exactly what asyncify could not do.

**Docker parity.** The variant choice is the one thing dev cannot prove, because
the failure is in file tracing rather than in code. Build the image and load the
variant from where Next actually puts it — a hashed symlink under
`.next/node_modules` pointing into the pnpm store:

```
docker build -t visvine-check .
docker run --rm --entrypoint sh visvine-check -c \
  "node -e \"require('/app/apps/web/.next/node_modules/@jitl/quickjs-singlefile-cjs-release-sync-'\\
   + require('fs').readdirSync('/app/apps/web/.next/node_modules/@jitl')[0].split('-').pop())\""
```

Simpler in practice: `ls /app/apps/web/.next/node_modules/@jitl/` in the image
and require whatever is there. If it is missing, the wasm did not survive
`output: "standalone"` — which is precisely the Cloud Run failure the singlefile
variant exists to avoid. `quickjs-emscripten-core` itself is bundled into the
server chunks and correctly absent from the store.

## Non-goals

- Body text granting permissions — perimeter stays frontmatter, non-negotiable.
- Keeping old executors alongside the isolate long-term — two call paths is
  how this stays a janky add-on.
- Per-vendor connector types (a Stripe type, a Notion type) — the note body is
  the vendor-specific layer.
- Non-HTTP protocols beyond Postgres/MySQL/MCP. SFTP, IMAP, Redis and gRPC are
  out of scope until a customer needs one, at which point it is a host function.
