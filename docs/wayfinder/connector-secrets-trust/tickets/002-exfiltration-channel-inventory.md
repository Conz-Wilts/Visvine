# Every channel by which a secret value can leave a connector run

<!-- labels: wayfinder:research -->
parent: ../map.md
status: closed
assignee: wayfinder-session-2026-08-17
blocked-by:

## Question

We cannot lock a trust model on top of a guess about our own code. Produce the honest,
exhaustive inventory: given an agent that authors arbitrary JavaScript for
`run_connector`, by what channels can the plaintext of `env.SOME_SECRET` reach that
agent, or reach anyone else?

Read `apps/web/lib/connectors/*` (especially `service.ts`, `isolate.ts`, `config.ts`,
`marshal.ts`, `hostFetch.ts`, `hostMcp.ts`, `hostSql.ts`, `postgres.ts`, `mysql.ts`,
`perimeter.ts`) and `apps/web/lib/mcp/tools.ts` around `run_connector`.

Trace at minimum:

1. **The return channel.** The run's return value goes back to the caller. `redactDeep`
   scrubs exact matches — establish precisely what it does and does not cover
   (transformed values, split strings, numeric encodings, values used as object keys,
   depth or size caps that truncate before scrubbing).
2. **Logs, errors, stacks, denials.** Each is redacted somewhere; confirm each path and
   look for anything that reaches the caller *unredacted* or that redacts only after a
   truncation.
3. **Outbound egress.** With the perimeter allowing host X, can a secret be smuggled to
   X — in a URL path, query string, header, or body? Is any of that reviewed, or is the
   perimeter purely a host/method/path gate? Note the `hostSql`/`postgres`/`mysql` paths
   separately, since a DSN *is* the credential there.
4. **Side channels.** Timing, deliberate error construction, response-size modulation —
   list them, but rank them honestly against the two threats in the map (a
   prompt-injected agent and a motivated member) rather than as theoretical curiosities.
5. **Who can even get here.** What gates reaching `run_connector` at all: which scope,
   which membership, which role, and whether any per-connector or per-secret restriction
   exists today.

For each channel, state: reachable or not, what stops it if anything, and how much
effort defeats that stopper. Do **not** propose fixes — this ticket establishes facts;
the fixes are other people's decisions.

Deliverable: `../research/exfiltration-channels.md`, with a summary table at the top and
file:line citations throughout.

## Resolution (2026-08-17)

Full inventory at [../research/exfiltration-channels.md](../research/exfiltration-channels.md).

**The answer: literal redaction is not a confidentiality boundary against code the caller
writes, and several channels move the whole secret in a single line with no network and
no allowed host.** The isolate, the perimeter and the SSRF gate all work as documented —
the leak is not a broken sandbox, it is that the sandbox was never trying to keep a
secret from the code running inside it.

Channels confirmed reachable, in rough order of how little effort they take:

1. **`error.name` is returned verbatim, never redacted.** `isolate.ts:496` redacts
   `message` and `stack` and passes `name` straight through beside them.
   `const e = new Error('x'); e.name = env.KEY; throw e` returns the plaintext. Works on
   a `hosts: []` connector with no network at all. *(Independently confirmed in code by
   the charting session.)*
2. **Any transform defeats redaction.** `redactSecrets` is a literal
   `split(value).join('[redacted]')` (`config.ts:194`). It is thorough about exact
   matches — every depth, object keys included — and blind to everything else:
   `["SUPE","RSECRET123"]`, char-code arrays and base64 all came back clean.
3. **Two truncate-before-scrub ordering bugs.** The 256 KB string cap runs at
   `isolate.ts:469`, redaction at `:492`, so padding a return value to push the secret
   across the cut yields a surviving prefix. Same shape for `logs` (clip `:389`, redact
   `:493`); `logs.join('\n')` additionally means a secret split across two `console.log`
   calls never matches. *(Ordering independently confirmed.)*
4. **Denials quote the caller's own hostname and path** (`perimeter.ts:80-82,110`), so a
   transformed secret placed in a hostname returns inside the refusal text — again
   without needing an allowed host. The SQL path is the one place that deliberately
   refuses to name what it denied (`hostSql.ts:36-40,69,74-78`).
5. **`result.location` is echoed unredacted** (`hostFetch.ts:245-246`) while the header
   map beside it is scrubbed at `:236`. *(Independently confirmed.)*
6. **Egress content is entirely unreviewed.** The gate is host+port and method+pathname
   only (`hostFetch.ts:191,194`); query string, headers and body are never inspected. An
   empty `allow:` is host-gated, not deny-all (`perimeter.ts:108`).
7. **SQL/DSN.** Both arguments originate in isolate code (`hostSql.ts:46`) and only
   host:port is gated (`:68`), leaving username/password/dbname as free smuggling space;
   `SELECT '<secret>'` is a legal read that lands plaintext in the upstream's query log,
   since the read-only guard blocks writes, not literals.
8. **Side channels** (timing via `duration_ms`, response size, denial count) are all
   reachable and all strategically irrelevant — they move bits where 1–5 move the whole
   value in one call.

**Gating is thinner than assumed:** `connectors:use` + space membership + read-visibility
of the note. No admin role is required to *run* a connector; the scope is granted by the
end user alone at the OAuth consent screen (`app/api/oauth/authorize/route.ts:117,194`)
with no admin approval. **There is no per-connector or per-secret restriction** — a run
receives every secret its note's `env:` names. Only *writing* connector notes is
admin-gated (`contextService.ts:236-246`).

**Consequences for the map:** the two threats collapse into one — a prompt-injected agent
and a motivated member have identical, one-line access, so no control that distinguishes
*intent* can help. Any trust model claiming confidentiality of a credential from the
agent is unsupportable under the current surface, which tilts
[the surface fork](004-agent-authored-js-surface.md) hard. Findings 1, 3 and 5 are
ordinary defects rather than design questions — see the map's Out of scope note.
