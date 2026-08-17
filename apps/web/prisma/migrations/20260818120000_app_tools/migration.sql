-- User-created Tools (lib/tools): a Tool is a note (`tools/<name>/index.md` +
-- `ui.md` + `data.md`) compiled server-side and run sandboxed in an iframe.
-- Four tables, none of which duplicate what the note already owns:
--
--   app_tool_builds   the author's space-local working copy: the latest
--                      compile of one Tool's sources (bundles, diagnostics,
--                      parsed config). One row per (space, name); overwritten
--                      on every save. Never read by an install.
--
--   app_tool_versions the GLOBAL, immutable marketplace registry. Publishing
--                      snapshots a build here for super-admin review; once
--                      approved a row never changes again (an upgrade is a
--                      new row). Keyed by `key` (`<sourceSpaceId>/<name>`) +
--                      `version`. `source_space_id` is deliberately not a
--                      foreign key — a published version must outlive its
--                      authoring space.
--
--   app_tool_installs a space's pinned install of one app_tool_versions row:
--                      enabled flag, requirements snapshot (unmet deps degrade
--                      rather than block), admin-confirmed type-page claims,
--                      and a pointer at an approved-but-not-yet-applied
--                      upgrade.
--
--   app_tool_state     per-install key/value storage for the Tool bridge's
--                      `visvine.state` capability (the iframe has no
--                      localStorage — it is sandboxed without
--                      allow-same-origin).
--
-- Additive only: no existing table changes shape, so this is safe on a re-run
-- and safe to deploy ahead of the code that uses it.

-- ── 1. Author working copy ──────────────────────────────────────────────────
CREATE TABLE "app_tool_builds" (
    "id"           TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id"     TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "source_hash"  TEXT NOT NULL,
    "ok"           BOOLEAN NOT NULL,
    "ui_bundle"    TEXT,
    "data_bundle"  TEXT,
    "errors"       JSONB NOT NULL DEFAULT '[]',
    "warnings"     JSONB NOT NULL DEFAULT '[]',
    "size_bytes"   INTEGER NOT NULL,
    "config"       JSONB,
    "config_error" TEXT,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_tool_builds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "app_tool_builds_space_id_name_key" ON "app_tool_builds"("space_id", "name");

ALTER TABLE "app_tool_builds"
  ADD CONSTRAINT "app_tool_builds_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 2. Global immutable marketplace registry ────────────────────────────────
CREATE TABLE "app_tool_versions" (
    "id"                TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "key"               TEXT NOT NULL,
    "name"              TEXT NOT NULL,
    "version"           INTEGER NOT NULL,
    "title"             TEXT NOT NULL,
    "description"       TEXT,
    "author_user_id"    TEXT,
    "source_space_id"   TEXT NOT NULL,
    "config"            JSONB NOT NULL,
    "perimeter"         JSONB NOT NULL,
    "index_source"      TEXT NOT NULL,
    "ui_source"         TEXT NOT NULL,
    "data_source"       TEXT NOT NULL,
    "ui_bundle"         TEXT NOT NULL,
    "data_bundle"       TEXT NOT NULL,
    "size_bytes"        INTEGER NOT NULL,
    "status"            TEXT NOT NULL DEFAULT 'pending',
    "submitted_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by"       TEXT,
    "reviewed_at"       TIMESTAMP(3),
    "review_note"       TEXT,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_tool_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "app_tool_versions_key_version_key" ON "app_tool_versions"("key", "version");
-- The review queue's and marketplace browse's one query.
CREATE INDEX "app_tool_versions_status_submitted_at_idx" ON "app_tool_versions"("status", "submitted_at");

-- No FK on source_space_id (see header) — a published version outlives its
-- authoring space.
ALTER TABLE "app_tool_versions"
  ADD CONSTRAINT "app_tool_versions_author_user_id_fkey"
  FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 3. Space-scoped installs ─────────────────────────────────────────────────
CREATE TABLE "app_tool_installs" (
    "id"                 TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id"           TEXT NOT NULL,
    "version_id"         TEXT NOT NULL,
    "key"                TEXT NOT NULL,
    "slug"               TEXT NOT NULL,
    "enabled"            BOOLEAN NOT NULL DEFAULT true,
    "installed_by"       TEXT NOT NULL,
    "requirements"       JSONB NOT NULL DEFAULT '{}',
    "type_claims"        JSONB NOT NULL DEFAULT '{}',
    "pending_version_id" TEXT,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_tool_installs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "app_tool_installs_space_id_key_key" ON "app_tool_installs"("space_id", "key");
CREATE UNIQUE INDEX "app_tool_installs_space_id_slug_key" ON "app_tool_installs"("space_id", "slug");

ALTER TABLE "app_tool_installs"
  ADD CONSTRAINT "app_tool_installs_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_tool_installs"
  ADD CONSTRAINT "app_tool_installs_version_id_fkey"
  FOREIGN KEY ("version_id") REFERENCES "app_tool_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- No FK on pending_version_id (see header) — an admin should still see "an
-- upgrade is available" even if that version row were ever withdrawn.

-- ── 4. Per-install bridge state ─────────────────────────────────────────────
CREATE TABLE "app_tool_state" (
    "id"         TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "install_id" TEXT NOT NULL,
    "key"        TEXT NOT NULL,
    "value"      JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_tool_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "app_tool_state_install_id_key_key" ON "app_tool_state"("install_id", "key");

ALTER TABLE "app_tool_state"
  ADD CONSTRAINT "app_tool_state_install_id_fkey"
  FOREIGN KEY ("install_id") REFERENCES "app_tool_installs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
