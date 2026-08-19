-- The note write path gets a transactional outbox.
--
-- docs/data-architecture.md calls the tier-2 projections "rebuildable by
-- replaying tier 1" — directory links from [[mentions]], AgentState from the
-- live note, AppToolBuild from the Tool sources, the space-config columns,
-- published replicas, folder indexes. That was true in principle and unbacked in
-- practice: lib/notes/store.ts committed the note row and then ran six side
-- effects as bare awaits, outside any transaction and with no record that they
-- were owed. A crash, a deploy mid-save, or one throwing hook left the
-- declaration stored and its projections stale, silently and permanently.
--
-- One row per note mutation, written in the SAME transaction as the note, and
-- deleted once the projections for that write have been rebuilt. The row IS the
-- record that the rebuild is owed; the drain (lib/notes/projections.ts) claims
-- due rows by compare-and-swap and re-runs them, which is safe because every
-- hook on the path is idempotent.
--
-- Deliberately NOT storing the note content: a retry re-reads the note and
-- projects what it says now, so a job that lands after a later edit converges on
-- the truth instead of replaying a stale copy.
--
-- Additive: safe to deploy ahead of the code that uses it.

CREATE TABLE "note_projection_jobs" (
    "id"          TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id"    TEXT NOT NULL,
    "owner_key"   TEXT NOT NULL,
    "path"        TEXT NOT NULL,
    -- write | rename | delete
    "kind"        TEXT NOT NULL,
    -- rename only: the path the note moved off
    "from_path"   TEXT,
    "origin"      TEXT NOT NULL DEFAULT 'edit',
    "actor_id"    TEXT NOT NULL,
    "actor_name"  TEXT NOT NULL,
    "actor_email" TEXT,
    "model"       TEXT,
    "changed"     BOOLEAN NOT NULL DEFAULT true,
    "attempts"    INTEGER NOT NULL DEFAULT 0,
    "last_error"  TEXT,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "run_after"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "done_at"     TIMESTAMP(3),

    CONSTRAINT "note_projection_jobs_pkey" PRIMARY KEY ("id")
);

-- The drain's only query: unsettled and due, oldest first. done_at leads the
-- index because the overwhelmingly common state is "settled and already
-- deleted", so the live set this has to scan stays tiny.
CREATE INDEX "note_projection_jobs_done_at_run_after_idx"
  ON "note_projection_jobs"("done_at", "run_after");

-- Coalescing lookup: an enqueue for a path that already has an unsettled job
-- reuses it rather than piling a second one on (a note saved five times while
-- the drain is behind owes ONE rebuild, not five).
CREATE INDEX "note_projection_jobs_space_id_owner_key_path_idx"
  ON "note_projection_jobs"("space_id", "owner_key", "path");

ALTER TABLE "note_projection_jobs"
  ADD CONSTRAINT "note_projection_jobs_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
