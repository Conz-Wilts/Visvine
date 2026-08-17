# Agents

Scheduled, self-hosted agents that run *from the context*: a Space authors an agent as a note,
an admin activates it, and Visvine runs the tool-calling loop on a schedule — reading and writing
the Space's notes, calling its connectors, and recording every run. This page is the operator and admin guide; the design decisions it records were made in the
agents planning map (2026-08-17).

**The quotable security property.** Your agents spend **your** model key, on a provider Visvine
ships, and reach only the connectors their brief declares. Connector credentials are decrypted
inside Visvine and never leave it — not to the model, not to a sandbox, not to you.

## An agent is two notes (plus a row)

| Path | Who writes | Holds |
|---|---|---|
| `agents/<name>.md` | any member (normal grants) | the **brief**: `type: agent`, `title`, `description`, `model`, `connectors`, `tools`, `max_turns`; the body is the system-prompt brief |
| `agents/live/<name>.md` | space admins only | the **activation**: `active`, `schedule` (`hourly\|daily\|weekly`), `at`, `on`, `timezone` |
| `agent_state` row | derived, never authoritative | `nextRunAt`, `status`, `runningSince`, `scheduleHash`, `runAsUserId`, `budgetMonthlyCents`, failure bookkeeping |

The write gate is path-only: one clause in `contextService.writeDenial` makes `agents/live/`
admin-write, and `lockedDenial` freezes all of `agents/` for AI origins (an AI sweep — or an
agent — can never rewrite a brief). **Budget is the one fact deliberately not in a note**: money is
admin-read while notes are member-read, so it lives on the row behind an admin-only route.

```yaml
# agents/weekly-digest.md
---
type: agent
title: Weekly digest
description: Summarises the week into reports/weekly.md
model: gemini/gemma-4-31b-it        # <provider>/<model-id> — a registry name, never a URL
connectors: [hubspot]              # declared reach
tools: [web]                       # optional: web (fetch_url), sandbox (stage 2)
max_turns: 16
---
Read this week's notes under updates/ and write a digest to reports/weekly.md …
```

### Rules the whole thing hangs on

- **A member's edit to a live brief auto-deactivates it** (`brief_changed`); an admin's edit does
  not — the admin approved a specific brief, and an admin editing it *is* the approval. The
  deactivating write is the only machine write into `agents/live/` and can only ever set
  `active: false`. Rename or delete of a brief also deactivates and carries the activation note.
- **The agent acts as its author** (`ContextNote.createdBy` of the brief): reads and writes go
  through the author's grants, so a member's agent can't read what the member can't. Author leaves →
  `author_gone`, deactivated.
- **Model keys are the Space's** — `MODEL_KEY_GEMINI` / `MODEL_KEY_OPENAI` / `MODEL_KEY_ANTHROPIC` /
  `MODEL_KEY_CUSTOM` in `ConnectorSecret` (encrypted, admin-only, write-only), managed from the
  Model keys card on `/agents`. Providers and their base URLs are pinned in `lib/agents/registry.ts`;
  `custom/<id>` uses the admin-only `Space.agentConfig.customEndpoint`.
- **Model connectors** — a provider can also appear as a connector: `connectors/<name>.md` with
  `type: connector`, `kind: model`, `provider: gemini|openai|anthropic|custom` (Create panel →
  Connector → *Model provider*). It sits in the Connectors list beside HTTP connectors, its page
  shows the provider, pinned base URL, known model ids and the `MODEL_KEY_<PROVIDER>` key editor,
  and a brief may name it in `connectors:`. It has no perimeter and is **never runnable** —
  `loadConnector` refuses `kind: model`, so MCP/agent `run_connector` and the console can't hand
  caller-authored JS the key. Base URL always comes from the registry, never the note
  (`lib/connectors/model.ts`).
- **Run now** shares the scheduler's compare-and-swap claim, requires the agent to be **active**
  (activation is the review point), does not advance the schedule, and is author-or-admin.

## What fires and what carries a run

- **One Cloud Scheduler job** hits `POST /api/internal/agents/tick` every 5 minutes with a Google
  OIDC token; the route verifies it itself (`lib/agents/internalAuth.ts`) because Cloud Run is
  `--allow-unauthenticated`. The tick: heartbeat → reclaim runs stuck > `MAX_RUN_MS` → prune old
  runs → re-derive rows whose activation note changed → CAS-claim due rows (`WHERE active AND
  status='idle' AND next_run_at <= now()`, ≤ 5 per tick, one running per space) → create run rows →
  **self-dispatch** each run as its own request to `POST /api/internal/agents/run` (60-second HS256
  token from `AUTH_SECRET`) and await them. No backfill: dispatch sets `next_run_at` to the next
  occurrence *after now*.
- Cloud Run `--timeout=1800`; Scheduler `attemptDeadline` 1500 s; `MAX_RUN_MS` = 20 min = the
  stale-run reclaim timeout (`lib/agents/limits.ts`). If runs ever need >30 min, swap
  `lib/agents/dispatch.ts` for Cloud Tasks; nothing else changes.
- Dev: `AGENT_DISPATCH=inline` (default outside production) runs inside the tick request;
  `curl -X POST -H "Authorization: Bearer $AGENT_TICK_SECRET" localhost:3000/api/internal/agents/tick`.
- Ceilings on a run: wall clock (`MAX_RUN_MS`), turns (`max_turns`, ≤ 40), spend (per-agent monthly
  cap + fixed per-run backstop). Not resumable: a dead run is failed and the agent waits for its
  next occurrence; partial note writes are revisions with origin `agent`, model `agent:<name>`.
- Failure policy: 401/403 from the provider → `key_rejected`, deactivated; 429/402/5xx → wait for
  the next occurrence; three consecutive failures → deactivated; budget reached → paused (not
  deactivated), resumes next month or when the cap is raised.
- Tick liveness: `agent_heartbeat` is written every tick; `/agents` shows a "scheduler delayed"
  banner when it is > 10 min old.

## Tools an agent gets (stage 1)

`list_context`, `search_context`, `read_context`, `write_context`, `append_context` (all through
the context service under the author's principal, origin `agent`), `run_connector` (only the names in
`connectors:`, via `loadConnector → executeConnectorScript` — the same single path the console and
MCP use), `fetch_url` when `tools: [web]`. Stage 2 (`tools: [sandbox]`) is a named seam in
`lib/agents/sandbox.ts`: `run_code` on a rented computer with no credentials and no network but
package registries; nothing is built until a vendor is chosen (`AGENT_SANDBOX_PROVIDER`).

## One-time production setup

```sh
# 1. A service account for the scheduler (no roles needed — the route checks the email claim)
gcloud iam service-accounts create visvine-agent-tick --project visvine-platform
# 2. Tell the app which SA to accept (set on the Cloud Run service; not in deploy.yml's --set-env-vars)
#    AGENT_TICK_SERVICE_ACCOUNT=visvine-agent-tick@visvine-platform.iam.gserviceaccount.com
# 3. The job
gcloud scheduler jobs create http visvine-agent-tick \
  --project visvine-platform --location australia-southeast1 \
  --schedule="*/5 * * * *" --time-zone=UTC \
  --uri="https://visvine.com/api/internal/agents/tick" --http-method=POST \
  --oidc-service-account-email=visvine-agent-tick@visvine-platform.iam.gserviceaccount.com \
  --oidc-token-audience="https://visvine.com/api/internal/agents/tick" \
  --attempt-deadline=1500s
```

Migration `20260817120000_agents` adds `spaces.timezone`, `spaces.agent_config`, `agent_state`,
`agent_runs`, `agent_heartbeat` — applied by `prisma migrate deploy` in the deploy workflow.

## Surfaces

- `/agents` — roster (members see everything but spend), activation toggle + dialog (admins), Run
  now (author/admin), Model keys (admins), scheduler banner.
- `/directory/agent:<name>` — Agent tab (status, activation, spend + budget, runs with live
  transcripts) beside the Context/Raw note tabs.
- Console → General → Agents: Space timezone, custom model endpoint.
- API: `GET/PATCH /api/communities/[spaceId]/agents[/[name]]`, `POST …/[name]/run`,
  `GET …/[name]/runs[/[runId]]`, `GET/PUT …/[name]/budget`.
- MCP: `list_agents` (`context:read`), `run_agent` (`agents:run`). Authoring is not an MCP tool.

## Code map

`lib/agents/{registry,providers,config,hooks,principal,tools,sandbox,budget,runs,runner,schedule,dispatch,internalAuth,service,route,limits}.ts`,
the shared loop `lib/notes/toolLoop.ts` (also under the connector-creation agent), the entity sync
points (`lib/notes/entities.ts`, `entityLinks.ts`, `context/entityNodes.ts`), feature key `agents`
(`lib/featureAccess.ts` + `features/shared/lib/features.tsx`), UI in `features/agents/*` and
`features/profile/components/AgentPageContent.tsx`. Tests: `tests/agents-config.test.ts`,
`tests/agents-budget.test.ts`, `tests/tool-loop.test.ts`, plus the gate cases in
`tests/clean-context.test.ts`.
