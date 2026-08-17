-- Agents: scheduled, self-hosted agent runs that read and write a space's
-- context (lib/agents). The agent itself is two NOTES — `agents/<name>.md`
-- (the brief, member-writable) and `agents/live/<name>.md` (activation +
-- schedule, admin-only) — so nothing about WHAT an agent is lives here. These
-- tables hold what notes cannot: the scheduler's index of who is due, an
-- atomic "running" flag that survives many instances, run history with usage
-- and cost, the admin-only budget, and a heartbeat for the tick itself.
--
-- Additive only: no existing row changes shape, so this is safe on a re-run
-- and safe to deploy ahead of the code that uses it.

-- ── 1. Space-level agent settings ────────────────────────────────────────────
-- `timezone`: the IANA zone an agent's `daily at 07:00` means when the agent
-- doesn't name one. `agent_config`: admin-only settings that must never be a
-- note field (a custom model endpoint is where the whole context gets POSTed).
ALTER TABLE "spaces" ADD COLUMN "timezone" TEXT;
ALTER TABLE "spaces" ADD COLUMN "agent_config" JSONB NOT NULL DEFAULT '{}';

-- ── 2. The scheduler's index of each agent ───────────────────────────────────
CREATE TABLE "agent_state" (
    "id"                    TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id"              TEXT NOT NULL,
    "name"                  TEXT NOT NULL,
    "run_as_user_id"        TEXT,
    "active"                BOOLEAN NOT NULL DEFAULT false,
    "status"                TEXT NOT NULL DEFAULT 'idle',
    "next_run_at"           TIMESTAMP(3),
    "last_run_at"           TIMESTAMP(3),
    "running_since"         TIMESTAMP(3),
    "schedule_hash"         TEXT,
    "budget_monthly_cents"  INTEGER,
    "deactivated_reason"    TEXT,
    "deactivated_detail"    TEXT,
    "consecutive_failures"  INTEGER NOT NULL DEFAULT 0,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_state_space_id_name_key" ON "agent_state"("space_id", "name");
-- The tick's one query: WHERE active AND next_run_at <= now().
CREATE INDEX "agent_state_active_next_run_at_idx" ON "agent_state"("active", "next_run_at");

ALTER TABLE "agent_state"
  ADD CONSTRAINT "agent_state_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 3. Run history ───────────────────────────────────────────────────────────
CREATE TABLE "agent_runs" (
    "id"                TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "state_id"          TEXT NOT NULL,
    "space_id"          TEXT NOT NULL,
    "name"              TEXT NOT NULL,
    "trigger"           TEXT NOT NULL,
    "status"            TEXT NOT NULL DEFAULT 'running',
    "started_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at"          TIMESTAMP(3),
    "started_by"        TEXT,
    "model"             TEXT,
    "prompt_tokens"     INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micros"       BIGINT,
    "turns"             INTEGER NOT NULL DEFAULT 0,
    "terminal_reason"   TEXT,
    "summary"           TEXT,
    "error_message"     TEXT,
    "events"            JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_runs_state_id_started_at_idx" ON "agent_runs"("state_id", "started_at" DESC);
CREATE INDEX "agent_runs_space_id_started_at_idx" ON "agent_runs"("space_id", "started_at");

ALTER TABLE "agent_runs"
  ADD CONSTRAINT "agent_runs_state_id_fkey"
  FOREIGN KEY ("state_id") REFERENCES "agent_state"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_runs"
  ADD CONSTRAINT "agent_runs_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 4. Tick heartbeat ────────────────────────────────────────────────────────
CREATE TABLE "agent_heartbeat" (
    "id"           INTEGER NOT NULL DEFAULT 1,
    "last_tick_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_heartbeat_pkey" PRIMARY KEY ("id")
);
