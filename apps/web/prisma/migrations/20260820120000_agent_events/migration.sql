-- Agent events: the payload MAILBOX behind reactive agents (lib/agents/events.ts).
--
-- An agent's live note may now say `on: { context: [globs], webhook: <connector> }`
-- and/or `every: 15m` beside the old `schedule:`. A note save under a glob or an
-- inbound webhook does NOT start a run: it inserts ONE row here and pulls the
-- agent's `next_run_at` forward to now()+debounce. The tick's compare-and-swap
-- claim stays the only dispatcher; when it claims the row it also claims every
-- unconsumed event (sets `consumed_by` = the run id) and the run reads them as
-- its input. So: no second scheduler, no consumer loop, one row per event.
--
-- Additive only.

-- ── 1. The mailbox ───────────────────────────────────────────────────────────
CREATE TABLE "agent_events" (
    "id"          TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id"    TEXT NOT NULL,
    "agent_name"  TEXT NOT NULL,
    "kind"        TEXT NOT NULL,            -- note_written | webhook | reply
    "source"      TEXT NOT NULL,            -- note path / connector name / who replied
    "summary"     TEXT NOT NULL,            -- one line for the run's "Triggered by" message
    "payload"     JSONB NOT NULL DEFAULT '{}',
    "dedupe_key"  TEXT,                     -- coalesce while unconsumed (e.g. one row per note path)
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed_by" TEXT,                     -- agent_runs.id once a run has claimed it

    CONSTRAINT "agent_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "agent_events"
  ADD CONSTRAINT "agent_events_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Pending events per agent, in arrival order — the claim query and the cap check.
CREATE INDEX "agent_events_pending_idx"
  ON "agent_events" ("space_id", "agent_name", "created_at")
  WHERE "consumed_by" IS NULL;

-- One pending row per dedupe key: fifty saves of the same note while the agent
-- is waiting collapse into one event (INSERT … ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX "agent_events_dedupe_key"
  ON "agent_events" ("space_id", "agent_name", "dedupe_key")
  WHERE "dedupe_key" IS NOT NULL AND "consumed_by" IS NULL;

-- A run's own events (the executor loads WHERE consumed_by = run id).
CREATE INDEX "agent_events_consumed_by_idx" ON "agent_events" ("consumed_by");

-- ── 2. What the state row derives from the live note's triggers ─────────────
-- `triggers_json` = the parsed `on:` map ({ context: [...], webhook: "..." }) so
-- the note-save hook and the webhook route can find recipients with one query;
-- `debounce_ms` = how far forward an event pulls next_run_at.
ALTER TABLE "agent_state" ADD COLUMN "triggers_json" JSONB;
ALTER TABLE "agent_state" ADD COLUMN "debounce_ms"   INTEGER NOT NULL DEFAULT 60000;

-- ── 3. What a run was given ─────────────────────────────────────────────────
-- `event_count` for the run list; `input` ({ events: [{kind, source, summary, at}] })
-- for the transcript's "Triggered by …" block, kept with the run (events prune
-- after 7 days, runs after 90). `trigger` gains the values event | webhook | interval.
ALTER TABLE "agent_runs" ADD COLUMN "event_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "agent_runs" ADD COLUMN "input"       JSONB;
