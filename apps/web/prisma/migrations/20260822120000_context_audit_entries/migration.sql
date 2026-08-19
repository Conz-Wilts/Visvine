-- The context audit trail becomes a real ledger table.
--
-- It used to live in the control-plane sidecar as ONE text column holding a
-- whole JSONL file ("audit.jsonl" in context_state). Appending meant reading
-- the entire blob, concatenating a line and writing it all back — with 45 call
-- sites, several of them fire-and-forget inside loops (searchContext logs one
-- entry per restricted hit). Concurrent appends therefore raced and silently
-- dropped entries, which is the one failure a compliance log must not have,
-- and every append cost O(size of the log).
--
-- One row per event instead. This is the third sidecar file to graduate the
-- same way — folders.json became context_grants, join-requests.jsonl became
-- context_access_requests — and the last one that carries an append-per-event
-- ledger. See docs/data-architecture.md.
--
-- Backfill included below, so no history is lost. Additive: safe to deploy
-- ahead of the code that uses it.

CREATE TABLE "context_audit_entries" (
    "id"       TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id"  TEXT NOT NULL,
    -- Display name captured AT THE TIME of the event. Deliberately denormalized:
    -- an audit trail must still read correctly after the user is renamed or
    -- deleted, so this is a fact about the event, not a join to a person.
    "name"     TEXT NOT NULL,
    "action"   TEXT NOT NULL,
    "path"     TEXT NOT NULL,
    "detail"   TEXT,

    CONSTRAINT "context_audit_entries_pkey" PRIMARY KEY ("id")
);

-- The only read: the newest N entries for one space (admin surface, capped).
CREATE INDEX "context_audit_entries_space_id_at_idx"
  ON "context_audit_entries"("space_id", "at" DESC);

ALTER TABLE "context_audit_entries"
  ADD CONSTRAINT "context_audit_entries_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill from the sidecar blobs. Each line of the old file is one JSON object
-- {at, userId, name, action, path, detail?}; `at` is epoch MILLISECONDS.
--
-- Done row-by-row in PL/pgSQL with a per-line exception handler rather than as
-- one INSERT…SELECT with a guarded cast: SQL does not promise that AND
-- short-circuits, so a single torn line (the old read-modify-write append could
-- produce one) would abort the whole migration on the ::jsonb cast. Recovering
-- an already-lossy log must not be able to block a deploy.
--
-- to_timestamp() yields timestamptz; AT TIME ZONE 'UTC' converts it to the
-- timestamp-without-zone the column stores, independent of the session zone.
DO $$
DECLARE
  rec    RECORD;
  parsed JSONB;
  moved  INT := 0;
  torn   INT := 0;
BEGIN
  FOR rec IN
    SELECT cs."space_id" AS space_id, btrim(line) AS line
    FROM "context_state" cs
    CROSS JOIN LATERAL regexp_split_to_table(cs."content", E'\n') AS line
    WHERE cs."name" = 'audit.jsonl' AND btrim(line) <> ''
  LOOP
    BEGIN
      parsed := rec.line::jsonb;
    EXCEPTION WHEN others THEN
      torn := torn + 1;
      CONTINUE;
    END;

    IF parsed IS NULL OR jsonb_typeof(parsed) <> 'object' OR (parsed ->> 'at') !~ '^\d+$' THEN
      torn := torn + 1;
      CONTINUE;
    END IF;

    INSERT INTO "context_audit_entries" ("space_id", "at", "user_id", "name", "action", "path", "detail")
    VALUES (
      rec.space_id,
      to_timestamp((parsed ->> 'at')::bigint / 1000.0) AT TIME ZONE 'UTC',
      COALESCE(parsed ->> 'userId', ''),
      COALESCE(parsed ->> 'name', ''),
      COALESCE(parsed ->> 'action', 'read'),
      COALESCE(parsed ->> 'path', ''),
      parsed ->> 'detail'
    );
    moved := moved + 1;
  END LOOP;

  RAISE NOTICE 'context audit backfill: % entries migrated, % unparseable lines skipped', moved, torn;
END $$;

-- The sidecar rows are left in place: this migration is reversible by code
-- rollback alone, and a stale copy of an append-only log is harmless. Dropping
-- them is a separate contract step once the new table has been running.
