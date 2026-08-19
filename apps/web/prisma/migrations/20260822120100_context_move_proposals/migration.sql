-- Publish/promotion proposals become a real table.
--
-- The last of the JSONL sidecar blobs (after folders.json → context_grants,
-- join-requests.jsonl → context_access_requests and audit.jsonl →
-- context_audit_entries). Queueing a proposal appended to one text column by
-- rewriting it whole, and RESOLVING one rewrote every proposal in the space
-- from a snapshot — so two admins deciding at the same time silently lost one
-- of the decisions.
--
-- Backfill included. Additive: safe to deploy ahead of the code that uses it.

CREATE TABLE "context_move_proposals" (
    "id"            TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id"      TEXT NOT NULL,
    "from_path"     TEXT NOT NULL,
    "to_path"       TEXT NOT NULL,
    "folder_id"     TEXT NOT NULL,
    "content"       TEXT NOT NULL,
    "kind"          TEXT NOT NULL DEFAULT 'copy',
    "proposed_by"   TEXT NOT NULL,
    -- Captured at proposal time, like context_audit_entries.name: the queue must
    -- still read correctly after the proposer is renamed or deleted.
    "proposer_name" TEXT NOT NULL,
    "proposed_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status"        TEXT NOT NULL DEFAULT 'pending',
    "resolved_by"   TEXT,
    "resolved_at"   TIMESTAMP(3),

    CONSTRAINT "context_move_proposals_pkey" PRIMARY KEY ("id")
);

-- The admin queue view: pending proposals for one space.
CREATE INDEX "context_move_proposals_space_id_status_idx"
  ON "context_move_proposals"("space_id", "status");

-- "my proposals", across statuses.
CREATE INDEX "context_move_proposals_proposed_by_idx"
  ON "context_move_proposals"("proposed_by");

ALTER TABLE "context_move_proposals"
  ADD CONSTRAINT "context_move_proposals_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill. Per-line exception handling for the same reason as the audit
-- migration: a torn line from the old read-modify-write append must not be able
-- to abort a deploy. The old `id` is preserved so any URL or client state
-- referring to a pending proposal keeps working.
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
    WHERE cs."name" = 'move-proposals.jsonl' AND btrim(line) <> ''
  LOOP
    BEGIN
      parsed := rec.line::jsonb;
    EXCEPTION WHEN others THEN
      torn := torn + 1;
      CONTINUE;
    END;

    IF parsed IS NULL OR jsonb_typeof(parsed) <> 'object' OR (parsed ->> 'id') IS NULL THEN
      torn := torn + 1;
      CONTINUE;
    END IF;

    INSERT INTO "context_move_proposals" (
      "id", "space_id", "from_path", "to_path", "folder_id", "content", "kind",
      "proposed_by", "proposer_name", "proposed_at", "status", "resolved_by", "resolved_at"
    )
    VALUES (
      parsed ->> 'id',
      rec.space_id,
      COALESCE(parsed ->> 'fromPath', ''),
      COALESCE(parsed ->> 'toPath', ''),
      COALESCE(parsed ->> 'folderId', ''),
      COALESCE(parsed ->> 'content', ''),
      COALESCE(parsed ->> 'kind', 'copy'),
      COALESCE(parsed ->> 'proposedBy', ''),
      COALESCE(parsed ->> 'proposerName', ''),
      CASE WHEN (parsed ->> 'proposedAt') ~ '^\d+$'
        THEN to_timestamp((parsed ->> 'proposedAt')::bigint / 1000.0) AT TIME ZONE 'UTC'
        ELSE CURRENT_TIMESTAMP END,
      COALESCE(parsed ->> 'status', 'pending'),
      parsed ->> 'resolvedBy',
      CASE WHEN (parsed ->> 'resolvedAt') ~ '^\d+$'
        THEN to_timestamp((parsed ->> 'resolvedAt')::bigint / 1000.0) AT TIME ZONE 'UTC'
        ELSE NULL END
    )
    -- The old file could hold the same id twice: resolving a proposal rewrote
    -- the whole blob, so a concurrent append could be replayed. Last writer in
    -- file order wins, which is what reading the file used to produce.
    ON CONFLICT ("id") DO UPDATE SET
      "status"      = EXCLUDED."status",
      "resolved_by" = EXCLUDED."resolved_by",
      "resolved_at" = EXCLUDED."resolved_at";
    moved := moved + 1;
  END LOOP;

  RAISE NOTICE 'move proposal backfill: % rows migrated, % unparseable lines skipped', moved, torn;
END $$;
