-- Tools: a version can be revoked after approval, a listing suspended or revoked,
-- incidents recorded, and concurrency caps held as leases shared by every
-- instance.
-- AlterTable
ALTER TABLE "app_tool_versions" ADD COLUMN     "revoke_reason" TEXT,
ADD COLUMN     "revoked_at" TIMESTAMP(3),
ADD COLUMN     "revoked_by" TEXT;

-- CreateTable
CREATE TABLE "app_tool_listings" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "key" TEXT NOT NULL,
    "publisher_space_id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "state_reason" TEXT,
    "state_by" TEXT,
    "state_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_tool_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_tool_incidents" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "key" TEXT,
    "version_id" TEXT,
    "install_id" TEXT,
    "space_id" TEXT,
    "viewer_id" TEXT,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_tool_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_leases" (
    "key" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "holder" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_leases_pkey" PRIMARY KEY ("key","slot")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_tool_listings_key_key" ON "app_tool_listings"("key");

-- CreateIndex
CREATE INDEX "app_tool_incidents_key_created_at_idx" ON "app_tool_incidents"("key", "created_at");

-- CreateIndex
CREATE INDEX "app_tool_incidents_status_created_at_idx" ON "app_tool_incidents"("status", "created_at");

-- CreateIndex
CREATE INDEX "rate_limit_leases_expires_at_idx" ON "rate_limit_leases"("expires_at");


-- Every Tool Visvine was already asked to list gets its listing row.
INSERT INTO "app_tool_listings" ("key", "publisher_space_id", "updated_at")
SELECT DISTINCT ON ("key") "key", "source_space_id", now()
FROM "app_tool_versions"
WHERE "marketplace_status" IS NOT NULL
ORDER BY "key", "version" DESC
ON CONFLICT ("key") DO NOTHING;

-- The enum-ish columns, enforced.
ALTER TABLE "app_tool_listings" ADD CONSTRAINT "app_tool_listings_state_check"
  CHECK ("state" IN ('active', 'suspended', 'revoked'));
ALTER TABLE "app_tool_incidents" ADD CONSTRAINT "app_tool_incidents_kind_check"
  CHECK ("kind" IN ('navigation', 'csp', 'report', 'canary', 'anomaly'));
ALTER TABLE "app_tool_incidents" ADD CONSTRAINT "app_tool_incidents_severity_check"
  CHECK ("severity" IN ('severe', 'flag', 'quality', 'report'));
ALTER TABLE "app_tool_incidents" ADD CONSTRAINT "app_tool_incidents_status_check"
  CHECK ("status" IN ('open', 'cleared', 'confirmed'));
