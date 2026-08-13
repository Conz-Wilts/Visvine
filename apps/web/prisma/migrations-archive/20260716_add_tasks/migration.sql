-- Tasks feature: a per-community kanban board.
--
-- One board per community, so there is no board table — columns and tasks key
-- directly on community_id. Default columns ("To do" / "In progress" / "Done")
-- are seeded lazily by the app on first board fetch, not by this migration.
--
-- Ordering:
--   * task_columns.position — dense integers; the reorder endpoint rewrites all
--     of a community's column positions in one transaction.
--   * tasks.position — float, ordered within its column; a drag writes a single
--     row ((prev+next)/2) and the app renormalizes a column when midpoints
--     exhaust the gap.
--
-- tasks.assignee_id is a plain userId string with no FK (same convention as
-- community_notes.created_by); a deleted user leaves a dangling id the UI
-- renders as "Unknown".

CREATE TABLE "task_columns" (
    "id"           TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "community_id" TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "color"        TEXT NOT NULL DEFAULT '#94a3b8',
    "position"     INTEGER NOT NULL,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_columns_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "task_columns_community_id_fkey" FOREIGN KEY ("community_id")
        REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "task_columns_community_id_position_idx"
    ON "task_columns"("community_id", "position");

CREATE TABLE "tasks" (
    "id"           TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "community_id" TEXT NOT NULL,
    "column_id"    TEXT NOT NULL,
    "title"        TEXT NOT NULL,
    "description"  TEXT NOT NULL DEFAULT '',
    "assignee_id"  TEXT,
    "due_date"     TIMESTAMP(3),
    "labels"       TEXT[] DEFAULT ARRAY[]::TEXT[],
    "position"     DOUBLE PRECISION NOT NULL,
    "created_by"   TEXT NOT NULL,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tasks_community_id_fkey" FOREIGN KEY ("community_id")
        REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tasks_column_id_fkey" FOREIGN KEY ("column_id")
        REFERENCES "task_columns"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "tasks_column_id_position_idx" ON "tasks"("column_id", "position");
CREATE INDEX "tasks_community_id_idx" ON "tasks"("community_id");
