-- The automated checks over a Tool, one row per stage per run (lib/tools/checks/).

-- CreateTable
CREATE TABLE "app_tool_check_runs" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT,
    "name" TEXT NOT NULL,
    "version_id" TEXT,
    "source_hash" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "findings" JSONB NOT NULL DEFAULT '[]',
    "risk" JSONB,
    "analyzer" TEXT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_tool_check_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_tool_check_runs_space_id_name_created_at_idx" ON "app_tool_check_runs"("space_id", "name", "created_at");

-- CreateIndex
CREATE INDEX "app_tool_check_runs_version_id_created_at_idx" ON "app_tool_check_runs"("version_id", "created_at");

-- AddForeignKey
ALTER TABLE "app_tool_check_runs" ADD CONSTRAINT "app_tool_check_runs_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_tool_check_runs" ADD CONSTRAINT "app_tool_check_runs_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "app_tool_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The enum-ish columns, enforced.
ALTER TABLE "app_tool_check_runs" ADD CONSTRAINT "app_tool_check_runs_stage_check"
  CHECK ("stage" IN ('compatibility', 'security'));
ALTER TABLE "app_tool_check_runs" ADD CONSTRAINT "app_tool_check_runs_status_check"
  CHECK ("status" IN ('passed', 'flagged', 'blocked'));
ALTER TABLE "app_tool_check_runs" ADD CONSTRAINT "app_tool_check_runs_trigger_check"
  CHECK ("trigger" IN ('check', 'publish', 'rescan'));
