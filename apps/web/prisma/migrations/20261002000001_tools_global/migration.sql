-- AlterTable
ALTER TABLE "app_tool_versions" ADD COLUMN     "cosigned_at" TIMESTAMP(3),
ADD COLUMN     "cosigned_by" TEXT,
ADD COLUMN     "digests" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "license" TEXT,
ADD COLUMN     "listing_id" TEXT,
ADD COLUMN     "listing_requested_at" TIMESTAMP(3),
ADD COLUMN     "listing_requested_by" TEXT,
ADD COLUMN     "package_digest" TEXT;

-- AlterTable
ALTER TABLE "app_tool_installs" ADD COLUMN     "listing_id" TEXT;

-- AlterTable
ALTER TABLE "app_tool_listings" ADD COLUMN     "author_user_id" TEXT,
ADD COLUMN     "license" TEXT,
ADD COLUMN     "listed_at" TIMESTAMP(3),
ADD COLUMN     "staged_cap" INTEGER,
ADD COLUMN     "staged_until" TIMESTAMP(3),
ADD COLUMN     "transfer_at" TIMESTAMP(3),
ADD COLUMN     "transfer_by" TEXT,
ADD COLUMN     "transfer_to" TEXT,
ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "app_tool_consents" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "install_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "acting" JSONB NOT NULL DEFAULT '{}',
    "consented_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_tool_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_tool_review_runs" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "version_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "runner" TEXT,
    "honeypot_space_id" TEXT,
    "runner_user_id" TEXT,
    "canaries" JSONB NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_tool_review_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_tool_review_events" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "run_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "method" TEXT,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_tool_review_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_tool_consents_user_id_idx" ON "app_tool_consents"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_tool_consents_install_id_user_id_key" ON "app_tool_consents"("install_id", "user_id");

-- CreateIndex
CREATE INDEX "app_tool_review_runs_status_created_at_idx" ON "app_tool_review_runs"("status", "created_at");

-- CreateIndex
CREATE INDEX "app_tool_review_runs_version_id_created_at_idx" ON "app_tool_review_runs"("version_id", "created_at");

-- CreateIndex
CREATE INDEX "app_tool_review_events_run_id_at_idx" ON "app_tool_review_events"("run_id", "at");

-- CreateIndex
CREATE INDEX "app_tool_versions_listing_id_idx" ON "app_tool_versions"("listing_id");

-- CreateIndex
CREATE INDEX "app_tool_installs_listing_id_idx" ON "app_tool_installs"("listing_id");

-- AddForeignKey
ALTER TABLE "app_tool_versions" ADD CONSTRAINT "app_tool_versions_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "app_tool_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_tool_consents" ADD CONSTRAINT "app_tool_consents_install_id_fkey" FOREIGN KEY ("install_id") REFERENCES "app_tool_installs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_tool_consents" ADD CONSTRAINT "app_tool_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_tool_review_runs" ADD CONSTRAINT "app_tool_review_runs_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "app_tool_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_tool_review_events" ADD CONSTRAINT "app_tool_review_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "app_tool_review_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: every version already offered to Visvine belongs to its key's
-- listing, and every install of one follows that listing.
UPDATE "app_tool_versions" v
SET "listing_id" = l."id"
FROM "app_tool_listings" l
WHERE v."key" = l."key" AND v."marketplace_status" IS NOT NULL AND v."listing_id" IS NULL;

UPDATE "app_tool_installs" i
SET "listing_id" = v."listing_id"
FROM "app_tool_versions" v
WHERE i."version_id" = v."id" AND v."listing_id" IS NOT NULL AND i."listing_id" IS NULL;

-- A request made before co-signing existed was the admin's alone; it stands as
-- asked and co-signed at the moment it was submitted.
UPDATE "app_tool_versions"
SET "listing_requested_at" = "marketplace_submitted_at",
    "cosigned_at" = "marketplace_submitted_at"
WHERE "marketplace_status" IS NOT NULL AND "listing_requested_at" IS NULL;

-- When each listing was first listed, and by whom it was written.
UPDATE "app_tool_listings" l
SET "listed_at" = first."listed_at"
FROM (
  SELECT "key", MIN("marketplace_reviewed_at") AS "listed_at"
  FROM "app_tool_versions"
  WHERE "marketplace_status" = 'approved'
  GROUP BY "key"
) first
WHERE l."key" = first."key" AND l."listed_at" IS NULL;

UPDATE "app_tool_listings" l
SET "author_user_id" = latest."author_user_id"
FROM (
  SELECT DISTINCT ON ("key") "key", "author_user_id"
  FROM "app_tool_versions"
  WHERE "marketplace_status" IS NOT NULL
  ORDER BY "key", "version" DESC
) latest
WHERE l."key" = latest."key" AND l."author_user_id" IS NULL;

-- The enum-ish columns, enforced — and a check run's stages and triggers
-- widened to Visvine's own two (lib/tools/review).
ALTER TABLE "app_tool_check_runs" DROP CONSTRAINT "app_tool_check_runs_stage_check";
ALTER TABLE "app_tool_check_runs" ADD CONSTRAINT "app_tool_check_runs_stage_check"
  CHECK ("stage" IN ('compatibility', 'security', 'ai', 'dynamic'));
ALTER TABLE "app_tool_check_runs" DROP CONSTRAINT "app_tool_check_runs_trigger_check";
ALTER TABLE "app_tool_check_runs" ADD CONSTRAINT "app_tool_check_runs_trigger_check"
  CHECK ("trigger" IN ('check', 'publish', 'rescan', 'review'));
ALTER TABLE "app_tool_review_runs" ADD CONSTRAINT "app_tool_review_runs_status_check"
  CHECK ("status" IN ('queued', 'running', 'passed', 'flagged', 'blocked', 'unavailable', 'error'));
ALTER TABLE "app_tool_review_events" ADD CONSTRAINT "app_tool_review_events_kind_check"
  CHECK ("kind" IN ('bridge', 'door', 'csp', 'navigation', 'egress', 'console'));
