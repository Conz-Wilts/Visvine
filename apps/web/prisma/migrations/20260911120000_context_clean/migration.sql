-- The space's nightly clean: one schedule row per space, and a row per pass.

CREATE TABLE "context_clean_schedules" (
    "space_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "hour" INTEGER NOT NULL DEFAULT 3,
    "minute" INTEGER NOT NULL DEFAULT 30,
    "mode" TEXT NOT NULL DEFAULT 'light',
    "target_path" TEXT,
    "apply_fixes" BOOLEAN NOT NULL DEFAULT true,
    "fix_kinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "run_as_user_id" TEXT NOT NULL,
    "embed_enabled" BOOLEAN NOT NULL DEFAULT true,
    "embed_after_clean" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "next_run_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),

    CONSTRAINT "context_clean_schedules_pkey" PRIMARY KEY ("space_id")
);

CREATE INDEX "context_clean_schedules_enabled_next_run_at_idx"
    ON "context_clean_schedules"("enabled", "next_run_at");

ALTER TABLE "context_clean_schedules"
    ADD CONSTRAINT "context_clean_schedules_space_id_fkey"
    FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "context_clean_runs" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "started_by" TEXT,
    "run_as_user_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'light',
    "target_path" TEXT,
    "analyzed_notes" INTEGER NOT NULL DEFAULT 0,
    "in_scope_notes" INTEGER NOT NULL DEFAULT 0,
    "safe_fixes" INTEGER NOT NULL DEFAULT 0,
    "applied" INTEGER NOT NULL DEFAULT 0,
    "applied_by_kind" JSONB NOT NULL DEFAULT '{}',
    "skipped" JSONB NOT NULL DEFAULT '[]',
    "worklist" JSONB NOT NULL DEFAULT '[]',
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "embed_status" TEXT NOT NULL DEFAULT 'skipped',
    "embedded_notes" INTEGER NOT NULL DEFAULT 0,
    "embedded_chunks" INTEGER NOT NULL DEFAULT 0,
    "embedded_sources" INTEGER NOT NULL DEFAULT 0,
    "embed_message" TEXT,
    "error_message" TEXT,

    CONSTRAINT "context_clean_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "context_clean_runs_space_id_started_at_idx"
    ON "context_clean_runs"("space_id", "started_at" DESC);

ALTER TABLE "context_clean_runs"
    ADD CONSTRAINT "context_clean_runs_space_id_fkey"
    FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The enum-ish columns say their values in the schema; the database enforces
-- them (tests/schema-constraints.test.ts).
ALTER TABLE "context_clean_schedules"
    ADD CONSTRAINT "context_clean_schedules_mode_check" CHECK ("mode" IN ('light', 'full'));

ALTER TABLE "context_clean_runs"
    ADD CONSTRAINT "context_clean_runs_trigger_check" CHECK ("trigger" IN ('scheduled', 'manual'));

ALTER TABLE "context_clean_runs"
    ADD CONSTRAINT "context_clean_runs_status_check" CHECK ("status" IN ('running', 'succeeded', 'failed', 'skipped'));

ALTER TABLE "context_clean_runs"
    ADD CONSTRAINT "context_clean_runs_mode_check" CHECK ("mode" IN ('light', 'full'));

ALTER TABLE "context_clean_runs"
    ADD CONSTRAINT "context_clean_runs_embed_status_check"
    CHECK ("embed_status" IN ('off', 'no-key', 'skipped', 'succeeded', 'failed'));

-- Chunked note embeddings: the retrieval unit for long notes. Keyed like
-- context_note_embeddings (no foreign key — a note's identity is a path that
-- moves on rename), and NO ANN index, for the reasons recorded in
-- 20260824120000_retrieval_index_correction: the stage narrows to the visible
-- notes' (path, mtime) before Postgres ranks, so an exact scan is right.
CREATE TABLE "context_note_chunks" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "owner_key" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "heading" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL,
    "mtime" BIGINT NOT NULL,
    "model" TEXT,
    "embedding" vector(768),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "context_note_chunks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "context_note_chunks_space_id_owner_key_path_seq_key"
    ON "context_note_chunks"("space_id", "owner_key", "path", "seq");

CREATE INDEX "context_note_chunks_space_id_owner_key_model_idx"
    ON "context_note_chunks"("space_id", "owner_key", "model");

ALTER TABLE "context_note_chunks"
    ADD CONSTRAINT "context_note_chunks_space_id_fkey"
    FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
