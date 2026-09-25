
-- AlterTable
ALTER TABLE "app_tool_incidents" ADD COLUMN     "listing_id" TEXT,
ADD COLUMN     "resolved_at" TIMESTAMP(3),
ADD COLUMN     "resolved_by" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'viewer';

-- CreateTable
CREATE TABLE "app_tool_publishers" (
    "space_id" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_tool_publishers_pkey" PRIMARY KEY ("space_id")
);

-- Visvine's word on a publisher moves from each listing to the publisher.
INSERT INTO "app_tool_publishers" ("space_id", "verified", "verified_at", "updated_at")
SELECT DISTINCT "publisher_space_id", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "app_tool_listings"
WHERE "verified" = true
ON CONFLICT ("space_id") DO NOTHING;

ALTER TABLE "app_tool_listings" DROP COLUMN "verified";

-- CreateTable
CREATE TABLE "app_tool_telemetry" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "install_id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "instance" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "refusals" INTEGER NOT NULL DEFAULT 0,
    "methods" JSONB NOT NULL DEFAULT '{}',
    "bytes_read" BIGINT NOT NULL DEFAULT 0,
    "bytes_written" BIGINT NOT NULL DEFAULT 0,
    "paths" INTEGER NOT NULL DEFAULT 0,
    "data_ms" INTEGER NOT NULL DEFAULT 0,
    "ai_tokens" INTEGER NOT NULL DEFAULT 0,
    "csp_reports" INTEGER NOT NULL DEFAULT 0,
    "navigations" INTEGER NOT NULL DEFAULT 0,
    "frame_errors" INTEGER NOT NULL DEFAULT 0,
    "viewers" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_tool_telemetry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_tool_advisories" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "package" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "advisory_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "url" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_tool_advisories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_tool_telemetry_day_idx" ON "app_tool_telemetry"("day");

-- CreateIndex
CREATE UNIQUE INDEX "app_tool_telemetry_install_id_day_instance_key" ON "app_tool_telemetry"("install_id", "day", "instance");

-- CreateIndex
CREATE UNIQUE INDEX "app_tool_advisories_package_version_advisory_id_key" ON "app_tool_advisories"("package", "version", "advisory_id");

-- CreateIndex
CREATE INDEX "app_tool_incidents_listing_id_status_idx" ON "app_tool_incidents"("listing_id", "status");

-- AddForeignKey
ALTER TABLE "app_tool_telemetry" ADD CONSTRAINT "app_tool_telemetry_install_id_fkey" FOREIGN KEY ("install_id") REFERENCES "app_tool_installs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Every incident a listed Tool raised names its listing.
UPDATE "app_tool_incidents" i
SET "listing_id" = l."id"
FROM "app_tool_listings" l
WHERE i."key" = l."key" AND i."listing_id" IS NULL;

-- The enum-ish columns, enforced — an incident's kinds widened to a rescan's.
ALTER TABLE "app_tool_incidents" DROP CONSTRAINT "app_tool_incidents_kind_check";
ALTER TABLE "app_tool_incidents" ADD CONSTRAINT "app_tool_incidents_kind_check"
  CHECK ("kind" IN ('navigation', 'csp', 'report', 'canary', 'anomaly', 'rescan'));
ALTER TABLE "app_tool_incidents" ADD CONSTRAINT "app_tool_incidents_source_check"
  CHECK ("source" IN ('viewer', 'dynamic', 'monitor', 'rescan'));
ALTER TABLE "app_tool_advisories" ADD CONSTRAINT "app_tool_advisories_severity_check"
  CHECK ("severity" IN ('low', 'medium', 'high'));
