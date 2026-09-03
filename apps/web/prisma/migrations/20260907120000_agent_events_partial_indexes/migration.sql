-- Restores the two partial indexes on `agent_events` that
-- 20260902050032_agent_state_brief_note_id dropped.
--
-- Prisma cannot express a WHERE clause, so these indexes exist only in
-- hand-written SQL (20260820120000_agent_events) and `prisma migrate dev`
-- regenerates their DROP into whatever migration it writes next. That drop is
-- what shipped in 20260902050032, and it is not editable after the fact — its
-- checksum is recorded in every database that has replayed it — so the repair
-- is a migration of its own.
--
-- The unique index is BEHAVIOURAL, not an optimisation: `enqueueAgentEvent`
-- collapses repeat events with INSERT … ON CONFLICT DO NOTHING, which has
-- nothing to conflict on while the index is missing.

-- The window with no unique index let duplicates in. Keep the earliest pending
-- row per (space, agent, dedupe_key) — the one whose arrival armed the agent —
-- or the CREATE below cannot take.
DELETE FROM "agent_events" a
USING "agent_events" b
WHERE a."consumed_by" IS NULL
  AND b."consumed_by" IS NULL
  AND a."dedupe_key" IS NOT NULL
  AND b."dedupe_key" IS NOT NULL
  AND a."space_id" = b."space_id"
  AND a."agent_name" = b."agent_name"
  AND a."dedupe_key" = b."dedupe_key"
  AND (a."created_at", a."id") > (b."created_at", b."id");

-- Pending events per agent, in arrival order — the claim query and the cap check.
CREATE INDEX IF NOT EXISTS "agent_events_pending_idx"
  ON "agent_events" ("space_id", "agent_name", "created_at")
  WHERE "consumed_by" IS NULL;

-- One pending row per dedupe key: fifty saves of the same note while the agent
-- is waiting collapse into one event.
CREATE UNIQUE INDEX IF NOT EXISTS "agent_events_dedupe_key"
  ON "agent_events" ("space_id", "agent_name", "dedupe_key")
  WHERE "dedupe_key" IS NOT NULL AND "consumed_by" IS NULL;
