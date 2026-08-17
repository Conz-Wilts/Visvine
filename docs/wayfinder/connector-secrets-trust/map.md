# Map: Connector secrets and agents we don't run

<!-- labels: wayfinder:map -->
<!-- tracker: local-markdown. Tickets are files in ./tickets/. A ticket is CLAIMED
     when its `assignee:` is set, CLOSED when its `status:` is closed. The FRONTIER
     is every ticket that is open, unassigned, and whose `blocked-by:` are all closed. -->

## Destination

A **locked trust model**, written down and agreed: a decision — not code, not a build —
stating what a connector's secret is allowed to touch once the pen is held by an agent
we don't run, which principal a connector run acts as, and where the real security
boundary sits. Done when nothing is left to decide before someone can go and plan an
implementation.

## Notes

**Domain.** Visvine connectors: a connector is a markdown note at `connectors/<name>.md`
whose YAML frontmatter declares a perimeter (`hosts:`, `allow:`) and an `env:` map of
`{{secret:NAME}}` references. Secrets live in `ConnectorSecret` (AES-256-GCM under a
server-wide `SECRETS_KEY`), decrypt only server-side, and are injected as `env` into a
sandboxed V8 isolate. The MCP tool `run_connector` lets a caller **author arbitrary
JavaScript** that runs in that isolate with `env` populated — so a client we do not
operate writes the code that touches the plaintext. Present defences: the perimeter
(`lib/connectors/perimeter.ts`, SSRF-gated) and literal exact-string redaction
(`redactSecrets` in `lib/connectors/config.ts`, applied over return values, logs, errors
and denials via `marshal.ts` / `isolate.ts`).

Key files: `apps/web/lib/connectors/{service,isolate,config,perimeter,marshal,hostFetch,agent}.ts`,
`apps/web/lib/mcp/{tools,scopes,clients}.ts`, `ConnectorSecret` in `apps/web/prisma/schema.prisma`.

**Threats in scope** (chosen 2026-08-17):
1. **Prompt-injected agent exfiltrates.** The external agent is honest but hijackable; a
   poisoned page or document makes it write code that smuggles a secret past literal
   redaction (base64, split, arithmetic — redaction is exact-match).
2. **The human behind the agent.** A member holding `connectors:use` deliberately using
   the sandbox to read out a credential their role shouldn't grant them.

Explicitly *not* the driving threats: the MCP client vendor seeing tool traffic, and
upstream blast radius. They may still be named in the model, but they don't get tickets.

**Standing preferences.**
- Planning only. Produce decisions, not deliverables. No code changes land from this map.
- This repo lands work directly in the working copy — no branches, no PRs (`CLAUDE.md`).
  Research output therefore goes in `./research/<name>.md`, not a `research/*` branch.
- The human driving this map is **not deeply familiar with the agent/MCP credential
  landscape**. Every HITL ticket must put its options in plain terms with a
  recommendation before asking for a decision — never present a naked fork.

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [How does everyone else hand credentials to an agent they don't run?](tickets/001-credential-landscape.md)
  — **nobody surveyed does what we do**: agent-authored code with a plaintext credential
  in scope appears in no surveyed product, so there is no published defence of the
  position and no attack literature for it. All eight comparable platforms proxy. MCP has
  a normative rule — "the third-party credentials MUST NOT transit through the MCP
  client" — though it is scoped to elicited credentials, and the spec never contemplates
  a client authoring code with the secret in scope. Scoped-credential mechanisms need
  upstream cooperation we mostly won't have. Crucially, **expressiveness and containment
  are not in tension**: Cloudflare Code Mode and Merge both run arbitrary agent-authored
  requests with the credential held server-side.
- [Every channel by which a secret value can leave a connector run](tickets/002-exfiltration-channel-inventory.md)
  — literal redaction is not a confidentiality boundary against code the caller writes;
  at least six channels return the whole plaintext in one line, several needing no
  network and no allowed host (`error.name` is never redacted at all). The isolate,
  perimeter and SSRF gate work as documented. Running a connector needs only
  `connectors:use` + membership, granted by the end user at the consent screen with no
  admin approval, and a run receives *every* secret its note names.

## Not yet specified

- **Human-in-the-loop consent.** Whether a secret-touching run should require a live
  human approval, and what that looks like across MCP clients we don't control. Shape
  depends entirely on [Is agent-authored JS an acceptable surface for secret-touching code?](tickets/004-agent-authored-js-surface.md).
- **Audit, rotation and incident response.** What we owe a space once we must assume a
  secret leaked — per-run audit trail, rotation story, blast-radius notification. Can't
  be phrased sharply until we know where the boundary is.
- **Client identity as trust weight.** Whether a registered MCP OAuth client (Client ID
  Metadata Documents, `lib/mcp/clients.ts`) can carry any trust that an unregistered one
  can't, or whether client identity is unfalsifiable enough to be worthless here.
  Depends on the tiers named in [What is "an agent we don't run"?](tickets/003-trust-tiers-and-principal.md).
- **The connector-building agent.** `lib/connectors/agent.ts` writes connector notes and
  runs probes. It claims never to see secret values. Whether it sits inside the same
  trust model or is a separate principal is unclear until the tiers exist.
- **Migration of existing connector notes** if the model forces a surface change. Sits on
  the planning/implementation seam — may prove out of scope once the model is locked.

## Out of scope

- **Fixing the three ordinary defects** found while charting — `error.name` returned
  unredacted (`isolate.ts:496`), `result.location` returned unredacted
  (`hostFetch.ts:245-246`), and redaction running after truncation rather than before
  (`isolate.ts:469` vs `:492`, `:389` vs `:493`). These are plain bugs in the existing
  redaction pass, not trust-model questions, and they should be fixed on their own clock
  rather than waiting for this map. **Raised to the human 2026-08-17; awaiting their
  call.** Note that fixing them does *not* close the exfiltration surface — see
  [the channel inventory](tickets/002-exfiltration-channel-inventory.md).
- **Implementing the model.** The destination is a locked decision; building, specifying
  the wire changes, and migrating notes are a separate effort downstream of this map.
- **Isolate escape hardening.** Whether the V8 sandbox itself can be broken out of is a
  distinct security effort with a different shape of evidence. This map assumes the
  isolate holds and asks what an agent can do *legitimately inside* it.
- **MCP OAuth spec compliance.** Already carried to the 2026-07-28 spec; not revisited here.
- **Upstream blast radius and the client vendor's visibility** — ruled out of the driving
  threat set when the destination was named (see Notes).
